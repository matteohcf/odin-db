export function DiagramMessage({ children }: { children: string }) {
  return (
    <p className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}
