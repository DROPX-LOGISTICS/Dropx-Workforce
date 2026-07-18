import Image from "next/image";
import { ConnectLoginFlow } from "@/components/connect-login-flow";

export const metadata = {
  title: {
    absolute: "DropX Connect"
  }
};

export default function DropXConnectPage() {
  return (
    <main className="connect-page">
      <section className="connect-desktop-block" aria-label="Desktop not supported">
        <Image alt="DropX" height={54} priority src="/dropx-logo.png" width={154} />
        <p>DropX Connect</p>
        <h1>Desktop not supported</h1>
        <span>Please open this app on a mobile device.</span>
      </section>

      <section className="connect-shell" aria-label="DropX Connect login">
        <div className="connect-brand">
          <Image alt="DropX" height={54} priority src="/dropx-logo.png" width={154} />
          <div>
            <p>DropX Connect</p>
            <h1>Sign in with your mobile number</h1>
          </div>
        </div>

        <ConnectLoginFlow />
      </section>
    </main>
  );
}
