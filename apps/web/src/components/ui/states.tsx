import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** ローディング・空・エラーの穏当なプレースホルダ表示。 */

export function LoadingState({ label = "読み込み中…" }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-neutral-400">
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-neutral-400">
      {children}
    </div>
  );
}

export function ErrorState({
  message,
  className,
}: {
  message: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss",
        className,
      )}
      role="alert"
    >
      {message}
    </div>
  );
}
