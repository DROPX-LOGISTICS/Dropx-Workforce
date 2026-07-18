import type { ReactNode } from "react";

type IconProps = {
  children: ReactNode;
};

export function Icon({ children }: IconProps) {
  return (
    <span aria-hidden="true" style={{ width: 18, display: "inline-grid", placeItems: "center" }}>
      {children}
    </span>
  );
}
