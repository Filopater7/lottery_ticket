import type { Metadata } from 'next';
import TVReceiver from '@/components/TVReceiver';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Lottery Display — TV',
};

interface TVPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function TVPage({ searchParams }: TVPageProps) {
  const params = await searchParams;
  const token = params.token ?? null;

  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <TVReceiver token={token} />
    </>
  );
}
