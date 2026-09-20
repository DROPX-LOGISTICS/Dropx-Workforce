import DropXConnectPage from "../page";

// DropX One keeps navigation state in the client, but its shared links include
// stable URLs such as /dashboard and /payments. Render the same shell for those
// deep links so refreshing or opening an app notification never produces a 404.
export default function DropXConnectScreenPage() {
  return <DropXConnectPage />;
}
