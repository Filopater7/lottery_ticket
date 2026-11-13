import type { Metadata } from 'next';
import TVReceiver from '@/components/TVReceiver';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Lottery Display — TV',
};

export default function TVPage() {
  return <TVReceiver />;
}
