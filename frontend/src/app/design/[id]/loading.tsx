export default function DesignLoading() {
  return (
    <div className="h-screen flex items-center justify-center bg-dark-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
        <p className="text-text-muted text-sm">加载中...</p>
      </div>
    </div>
  );
}
