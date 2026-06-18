// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mutlu Erol

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  KeyRound,
  Unlock,
  Lock,
  Power,
  PowerOff,
  Trash2,
  ShieldOff,
} from "lucide-react";
import type { User } from "@/types/user";
import { computeUserStatus } from "@/types/user";
import { useTranslation } from "react-i18next";

export interface UserActionMenuProps {
  user: User;
  onResetPassword: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onResetMfa: () => void;
  onDelete: () => void;
  isSelf?: boolean;
}

interface MenuItem {
  key: string;
  icon: typeof KeyRound;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  show: boolean;
}

export function UserActionMenu(props: UserActionMenuProps) {
  const { t } = useTranslation("common");
  const { user, isSelf } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const status = computeUserStatus(user);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: MenuItem[] = [
    {
      key: "reset-pw",
      icon: KeyRound,
      label: "common:userActions.resetPassword",
      onClick: props.onResetPassword,
      show: true,
    },
    {
      key: "unlock",
      icon: Unlock,
      label: "common:userActions.unlock",
      onClick: props.onUnlock,
      show: status === "locked",
    },
    {
      key: "lock",
      icon: Lock,
      label: "Kilitle",
      onClick: props.onLock,
      show: status === "active" && !isSelf,
    },
    {
      key: "activate",
      icon: Power,
      label: "common:userActions.activate",
      onClick: props.onActivate,
      show: status === "disabled",
    },
    {
      key: "deactivate",
      icon: PowerOff,
      label: "common:userActions.disable",
      onClick: props.onDeactivate,
      show: status === "active" && !isSelf,
    },
    {
      key: "reset-mfa",
      icon: ShieldOff,
      label: "common:userActions.resetMfa",
      onClick: props.onResetMfa,
      show: user.mfa_enabled,
    },
    {
      key: "delete",
      icon: Trash2,
      label: "Sil",
      onClick: props.onDelete,
      destructive: true,
      show: !isSelf,
    },
  ];

  const visible = items.filter((i) => i.show);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="Eylemler"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {visible.map((item, idx) => {
            const Icon = item.icon;
            const lastBeforeDestructive =
              !item.destructive && visible[idx + 1]?.destructive;
            return (
              <div key={item.key}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                    item.destructive
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-fg hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
                {lastBeforeDestructive && (
                  <div className="border-t border-border" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
