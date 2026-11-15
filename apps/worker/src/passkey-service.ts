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

/** Lifetime of a WebAuthn challenge. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengeRow {
  challenge: string;
  user_id: string | null;
  created_at: number;
  expires_at: number;
}

export class PasskeyService {
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
   * Stores a challenge in D1 with a 5-minute lifetime (table webauthn_challenges).
   * A new challenge for the same key replaces the old one. Expired rows are purged
   * on the way, the hourly cron removes the rest.
   */
  async storeChallenge(key: string, challenge: string, userId?: string): Promise<void> {
    const now = Date.now();
    const { db } = this.opts.repo;
    await db.run("DELETE FROM webauthn_challenges WHERE expires_at <= ?", [now]);
    await db.run(
      `INSERT INTO webauthn_challenges (challenge_key, challenge, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(challenge_key) DO UPDATE SET
         challenge = excluded.challenge,
         user_id = excluded.user_id,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
      [key, challenge, userId ?? null, now, now + CHALLENGE_TTL_MS]
    );
  }

  /**
   * Takes a challenge out of D1 in one statement (DELETE ... RETURNING), so it can be
   * used exactly once even with parallel requests on several instances. Returns null
   * when the challenge is unknown, already used, expired, or was issued to another user.
   */
  async consumeChallenge(key: string, expectedUserId?: string): Promise<StoredChallenge | null> {
    const rows = await this.opts.repo.db.query<ChallengeRow>(
      `DELETE FROM webauthn_challenges WHERE challenge_key = ?
       RETURNING challenge, user_id, created_at, expires_at`,
      [key]
    );
    const row = rows[0];
    if (!row || row.expires_at <= Date.now()) {
      return null;
    }
    if ((row.user_id ?? undefined) !== expectedUserId) {
      return null;
    }
    return {
      challenge: row.challenge,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at
    };
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

    await this.storeChallenge(`reg:${user.id}`, options.challenge, user.id);
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
    const stored = await this.consumeChallenge(`reg:${user.id}`, user.id);
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
    await this.storeChallenge(challengeKey, options.challenge);
    return options;
  }

  /**
   * Verifies login assertion with sign_count clone detection.
   */
  async verifyLogin(
    response: AuthenticationResponseJSON
  ): Promise<{ verified: boolean; user: UserRow; signCountUpdated: boolean }> {
    const challengeKey = `login:${response.response.clientDataJSON ? extractChallengeFromClientData(response.response.clientDataJSON) : ""}`;
    const stored = await this.consumeChallenge(challengeKey);
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
