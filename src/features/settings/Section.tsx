import type { ReactNode } from "react";
import { Card } from "@/components/ui/Feedback";

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="grid grid-cols-[16rem_1fr] gap-6 p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <div className="mt-1 text-[13px] leading-relaxed text-muted">{description}</div>}
      </div>
      <div>{children}</div>
    </Card>
  );
}
