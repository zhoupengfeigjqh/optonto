import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OPTONTO 本体市场',
  description: '本体开发平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-dark-bg text-text-primary" style={{backgroundColor:'#0a0a0f'}}>{children}</body>
    </html>
  );
}
