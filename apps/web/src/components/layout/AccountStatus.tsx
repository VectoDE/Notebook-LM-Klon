import { Icon } from "@/components/ui/index.js";
import { useTheme } from "@/hooks/index.js";

/** Gast-Zustand des Kontos, keine erfundenen Konten (Issue #325). Anmelden öffnet den Dialog (Issue #233). */
export function AccountStatus() {
  const { t } = useTheme();
  return (
    <div className="rn-account-status" data-testid="account-status">
      <span className="rn-account-avatar" aria-hidden="true">
        <Icon name="account" size={28} />
      </span>
      <div className="rn-account-text">
        <p className="rn-account-name">{t("accountGuest")}</p>
        <p className="rn-account-state">{t("accountSignedOut")}</p>
      </div>
      <p className="rn-account-hint">{t("accountText")}</p>
    </div>
  );
}
