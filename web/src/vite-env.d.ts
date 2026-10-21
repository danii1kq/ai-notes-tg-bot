/// <reference types="vite/client" />

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: { id: number; first_name: string } };
        ready(): void;
        expand(): void;
        close(): void;
        colorScheme: "light" | "dark";
        themeParams: Record<string, string>;
        BackButton: {
          show(): void;
          hide(): void;
          onClick(cb: () => void): void;
          offClick(cb: () => void): void;
        };
        HapticFeedback: {
          impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
          notificationOccurred(type: "success" | "error" | "warning"): void;
          selectionChanged(): void;
        };
      };
    };
  }
}

export {};
