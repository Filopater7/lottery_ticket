import Image from 'next/image';
import type { LotteryItem } from '@/types';

interface TicketCardProps {
  item: LotteryItem;
}

const PLACEHOLDER = (num: number) =>
  `https://placehold.co/400x240/1e293b/94a3b8?text=${encodeURIComponent(`#${num}`)}`;

export default function TicketCard({ item }: TicketCardProps) {
  const imageUrl = item.image_url || PLACEHOLDER(item.number);

  return (
    <article className="card overflow-hidden flex flex-col group hover:shadow-md transition-shadow duration-200">
      {/* Image area */}
      <div className="relative w-full bg-slate-100" style={{aspectRatio: '5/3'}}>
        <Image
          src={imageUrl}
          alt={item.title ? `${item.title} — ticket ${item.number}` : `Lottery ticket #${item.number}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
          className="object-cover"
          loading="lazy"
          unoptimized={imageUrl.startsWith('https://placehold.co')}
        />
        {/* Number badge */}
        <span className="absolute top-2 left-2 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/80 text-white text-xs font-bold font-mono tabular-nums backdrop-blur-sm">
          {item.number}
        </span>
      </div>

      {/* Content */}
      {item.title && (
        <div className="px-3 py-2.5">
          <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
        </div>
      )}
    </article>
  );
}
