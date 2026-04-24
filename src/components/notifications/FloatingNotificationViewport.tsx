import { useStore } from "../../lib/store";
import { useAppUpdate } from "../../features/update/AppUpdateProvider";
import { UpdateToast } from "../../features/update/UpdateToast";

export function FloatingNotificationViewport() {
  const { state, startUpdate, dismissUpdate } = useAppUpdate();
  const floatingNotifications = useStore((store) => store.floatingNotifications);

  if (state.stage === "idle" && floatingNotifications.length === 0) {
    return null;
  }

  return (
    <div className="app-notification-stack" role="region" aria-live="polite" aria-label="Application notifications">
      {state.stage !== "idle" ? (
        <UpdateToast state={state} onUpdate={() => void startUpdate()} onDismiss={() => void dismissUpdate()} />
      ) : null}
      {floatingNotifications.map((notification) => (
        <section
          key={notification.id}
          className={`app-floating-notice-card is-${notification.tone}`}
          aria-label={notification.title}
        >
          <div className="app-floating-notice-header">
            <div>
              <div className="app-floating-notice-eyebrow">{notification.eyebrow}</div>
              <div className="app-floating-notice-title">{notification.title}</div>
            </div>
          </div>
          <div className="app-floating-notice-message">{notification.message}</div>
        </section>
      ))}
    </div>
  );
}
