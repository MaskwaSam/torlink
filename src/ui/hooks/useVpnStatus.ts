import { useEffect, useState } from "react";
import { vpnStatus, VPN_POLL_MS, type VpnStatus } from "../../security/vpn";

function sameStatus(a: VpnStatus, b: VpnStatus): boolean {
  return (
    a.ok === b.ok &&
    a.reason === b.reason &&
    a.activeInterfaces.join("\0") === b.activeInterfaces.join("\0")
  );
}

export function useVpnStatus(): VpnStatus {
  const [status, setStatus] = useState<VpnStatus>(() => vpnStatus());

  useEffect(() => {
    const poll = (): void => {
      const next = vpnStatus();
      setStatus((cur) => (sameStatus(cur, next) ? cur : next));
    };
    poll();
    const timer = setInterval(poll, VPN_POLL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }, []);

  return status;
}
