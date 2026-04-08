"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NotificationPreviewDialogProps {
  html: string;
  subject: string;
  open: boolean;
  onClose: () => void;
}

export function NotificationPreviewDialog({
  html,
  subject,
  open,
  onClose,
}: NotificationPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{subject}</DialogTitle>
        </DialogHeader>
        <iframe
          srcDoc={html}
          className="w-full h-[60vh] border rounded bg-white"
          sandbox="allow-same-origin"
          title={subject}
        />
      </DialogContent>
    </Dialog>
  );
}
