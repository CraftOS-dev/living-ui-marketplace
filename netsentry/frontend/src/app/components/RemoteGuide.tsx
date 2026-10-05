/**
 * "Use it from away, safely" (docs/SYSTEM-V2-PLAN.md §17): the private ways to
 * reach an app from outside, instead of opening a port on the router. NetSentry
 * sees Tailscale, Cloudflare Tunnel and VPNs on the machine, and the app's
 * "Who can reach it" then shows the new path.
 */
function Option({ title, when, steps, note }: { title: string; when: string; steps: React.ReactNode[]; note?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="mt-0.5 text-[13px] text-[var(--agent-app-muted)]">{when}</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {note && <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">{note}</p>}
    </div>
  );
}

export function RemoteGuide({ appName, machine, port, windows }: { appName: string; machine: string; port: number | null; windows: boolean }): React.JSX.Element {
  const url = `http://${machine}${port ? `:${port}` : ''}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-relaxed">
        Opening a port on your router lets <em>anyone</em> on the internet find {appName} and try to get in. These ways let only you — or the people you choose — in.
      </p>
      <Option
        title="Tailscale — for you and your family's own devices (recommended)"
        when="Free for personal use. Each device gets a small app; no router changes."
        steps={[
          windows ? (
            <>On {machine}, install Tailscale from tailscale.com/download and sign in.</>
          ) : (
            <>
              On {machine}: <code>curl -fsSL https://tailscale.com/install.sh | sh</code> then <code>sudo tailscale up</code> and open the sign-in link it prints.
            </>
          ),
          'Install the Tailscale app on your phone and laptop, and sign in with the same account.',
          <>
            Away from home, open {appName} at <code>{url}</code>.
          </>,
          'Then remove any rule for this app in your router’s port forwarding page.',
        ]}
        note="NetSentry notices Tailscale on this server within 15 minutes and shows “your own devices when away” under Who can reach it."
      />
      <Option
        title="Cloudflare Tunnel with Access — for people without an app"
        when="Needs a domain on Cloudflare (free plan). People sign in with a code sent to their email."
        steps={[
          'In the Cloudflare dashboard, open Zero Trust → Networks → Tunnels and create a tunnel; run the connector command it shows on this server.',
          <>
            Add a public hostname (for example <code>{appName.toLowerCase().replace(/[^a-z0-9]+/g, '')}.yourdomain.com</code>) pointing to <code>http://localhost{port ? `:${port}` : ''}</code>.
          </>,
          'In Zero Trust → Access → Applications, protect that hostname and allow only the email addresses of the people you choose.',
        ]}
        note="Without the Access step, the hostname is open to the whole internet — NetSentry flags that."
      />
      <Option
        title="Your own VPN (WireGuard) — if your router has one"
        when="Many routers (FRITZ!Box, UniFi, OPNsense…) include a WireGuard server."
        steps={['Turn on the router’s VPN server and add each phone or laptop as a peer.', `Connected to the VPN, open ${appName} at its home address (${url}).`]}
      />
    </div>
  );
}
