import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SessionBootstrap } from '@/components/shared/session-bootstrap';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'RE:TURN — A living museum record',
  description: 'A living museum collection where communities and curators reconstruct incomplete object histories together.',
  openGraph: { title:'RE:TURN — A living museum record', description:'Every object has more than one history.', images:['/og.png'] },
  twitter: { card:'summary_large_image', title:'RE:TURN — A living museum record', description:'Every object has more than one history.', images:['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The first thing a keyboard reaches on every page, and the only thing that is invisible
  // until it is focused. Without it, reaching a contribution meant tabbing past the whole
  // header on every record in the collection (V9-8).
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <a className="skip-link" href="#main">Skip to the record</a>
        <SessionBootstrap />
        {children}
      </body>
    </html>
  );
}
