import type { PasskeyRow, UserRow } from "@notebook-lm/shared";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import type { CoreRepository } from "./core-repository.js";

export interface PasskeyServiceOptions {
  repo: CoreRepository;
  rpName: string;
  rpID: string;
  expectedOrigin: string;
}

export interface StoredChallenge {
  challenge: string;
  userId?: string | undefined;
  createdAt: number;
}

export type WebAuthnEngine = {
  // biome-ignore lint/suspicious/noExplicitAny: allow test doubles
  generateRegistrationOptions: (options: any) => Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: allow test doubles
  verifyRegistrationResponse: (options: any) => Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: allow test doubles
  generateAuthenticationOptions: (options: any) => Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: allow test doubles
  verifyAuthenticationResponse: (options: any) => Promise<any>;
};

export class PasskeyService {
  // In-memory / fast ephemeral challenge store with 5-minute TTL
  private challenges = new Map<string, StoredChallenge>();

  constructor(
    readonly opts: PasskeyServiceOptions,
    readonly webauthn: WebAuthnEngine = {
      generateRegistrationOptions,
      verifyRegistrationResponse,
      generateAuthenticationOptions,
      verifyAuthenticationResponse
    }
  ) {}

  /**
   * Stores a challenge with 5-minute TTL and cleans up expired ones.
   */
  storeChallenge(key: string, challenge: string, userId?: string): void {
    const now = Date.now();
    this.challenges.set(key, { challenge, userId, createdAt: now });
    // Clean expired
    for (const [k, v] of this.challenges.entries()) {
      if (now - v.createdAt > 5 * 60 * 1000) {
        this.challenges.delete(k);
      }
    }
  }

  /**
   * Retrieves and immediately consumes a challenge (single-use guarantee).
   */
  consumeChallenge(key: string): StoredChallenge | null {
    const item = this.challenges.get(key);
    if (!item) {
      return null;
    }
    this.challenges.delete(key);
    const now = Date.now();
    if (now - item.createdAt > 5 * 60 * 1000) {
      return null;
    }
    return item;
  }

  /**
   * Generates WebAuthn registration options for an existing user or upgrading guest.
   */
  async generateRegistrationOptions(user: UserRow) {
    const existingPasskeys = await this.opts.repo.getPasskeysByUserId(user.id);
    const excludeCredentials = existingPasskeys.map((p) => {
      const transports = p.transports
        ? (p.transports.split(",") as AuthenticatorTransportFuture[])
        : undefined;
      return transports ? { id: p.id, transports } : { id: p.id };
    });

    const options = (await this.webauthn.generateRegistrationOptions({
      rpName: this.opts.rpName,
      rpID: this.opts.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email ?? `user_${user.id}`,
      userDisplayName: user.display_name,
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
      }
    })) as PublicKeyCredentialCreationOptionsJSON;

    this.storeChallenge(`reg:${user.id}`, options.challenge, user.id);
    return options;
  }

  /**
   * Verifies WebAuthn attestation response and saves passkey to database.
   * If the user was a guest, seamlessly upgrades account to permanent (is_guest = 0, expires_at = null).
   */
  async verifyRegistration(
    user: UserRow,
    response: RegistrationResponseJSON
  ): Promise<{ verified: boolean; upgradedToPermanent: boolean }> {
    const stored = this.consumeChallenge(`reg:${user.id}`);
    if (!stored) {
      throw new Error("Challenge expired or invalid.");
    }

    const verification = (await this.webauthn.verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: this.opts.expectedOrigin,
      expectedRPID: this.opts.rpID,
      requireUserVerification: false
    })) as VerifiedRegistrationResponse;

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, upgradedToPermanent: false };
    }

    const { credential } = verification.registrationInfo;

    const passkeyRow: PasskeyRow = {
      id: credential.id,
      user_id: user.id,
      public_key: credential.publicKey,
      sign_count: credential.counter,
      transports: response.response.transports ? response.response.transports.join(",") : null,
      aaguid: null,
      created_at: Date.now(),
      last_used_at: null
    };

    await this.opts.repo.createPasskey(passkeyRow);

    let upgradedToPermanent = false;
    if (user.is_guest === 1) {
      await this.opts.repo.db.run("UPDATE users SET is_guest = 0, expires_at = NULL WHERE id = ?", [
        user.id
      ]);
      upgradedToPermanent = true;
    }

    return { verified: true, upgradedToPermanent };
  }

  /**
   * Generates WebAuthn login assertion options for discoverable credentials.
   */
  async generateLoginOptions() {
    const options = (await this.webauthn.generateAuthenticationOptions({
      rpID: this.opts.rpID,
      userVerification: "preferred"
    })) as PublicKeyCredentialRequestOptionsJSON;

    const challengeKey = `login:${options.challenge}`;
    this.storeChallenge(challengeKey, options.challenge);
    return options;
  }

  /**
   * Verifies login assertion with sign_count clone detection.
   */
  async verifyLogin(
    response: AuthenticationResponseJSON
  ): Promise<{ verified: boolean; user: UserRow; signCountUpdated: boolean }> {
    const challengeKey = `login:${response.response.clientDataJSON ? extractChallengeFromClientData(response.response.clientDataJSON) : ""}`;
    const stored = this.consumeChallenge(challengeKey);
    if (!stored) {
      throw new Error("Challenge expired or invalid.");
    }

    // Retrieve passkey from D1
    const passkeyRows = await this.opts.repo.db.query<PasskeyRow>(
      "SELECT * FROM passkeys WHERE id = ?",
      [response.id]
    );
    const passkey = passkeyRows[0];
    if (!passkey) {
      throw new Error("Passkey not found.");
    }

    const user = await this.opts.repo.getUserById(passkey.user_id);
    if (!user || user.deleted_at !== null) {
      throw new Error("User associated with passkey not found or deleted.");
    }

    const verification = (await this.webauthn.verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: this.opts.expectedOrigin,
      expectedRPID: this.opts.rpID,
      credential: {
        id: passkey.id,
        publicKey: passkey.public_key,
        counter: passkey.sign_count
      },
      requireUserVerification: false
    })) as VerifiedAuthenticationResponse;

    if (!verification.verified || !verification.authenticationInfo) {
      return { verified: false, user, signCountUpdated: false };
    }

    const newCounter = verification.authenticationInfo.newCounter;

    // Clone detection: If newCounter is less than or equal to existing sign_count (and not 0)
    // authenticator cloning might have occurred.
    if (newCounter <= passkey.sign_count && passkey.sign_count > 0) {
      throw new Error("Potential authenticator cloning detected: sign_count did not increment.");
    }

    const now = Date.now();
    await this.opts.repo.db.run(
      "UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?",
      [newCounter, now, passkey.id]
    );

    return { verified: true, user, signCountUpdated: true };
  }
}

function extractChallengeFromClientData(clientDataJSONBase64Url: string): string {
  try {
    const binary = atob(clientDataJSONBase64Url.replace(/-/g, "+").replace(/_/g, "/"));
    const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(text) as { challenge: string };
    return parsed.challenge;
  } catch {
    return "";
  }
}
