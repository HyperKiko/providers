import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { compareMedia } from '@/utils/compare';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';
import { Qualities, Stream, StreamFile } from '../streams';

const baseUrl = 'https://mbp.pirxcy.dev/';

function mapQuality(quality: string): Qualities {
  switch (quality) {
    case '4K':
      return '4k';
    case '1080p':
      return '1080';
    case '720p':
    case 'HDTV':
      return '720';
    case '480p': // haven't found a video with this quality yet
      return '480';
    case '360p':
      return '360';
    default:
      return 'unknown';
  }
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const searchResults: { data: { id: number; title: string; year: number }[] } = await ctx.proxiedFetcher('/search', {
    baseUrl,
    query: {
      q: ctx.media.title,
      type: ctx.media.type === 'movie' ? 'movie' : 'tv',
      year: ctx.media.releaseYear.toString(),
    },
  });

  ctx.progress(40);

  const mediaID = searchResults.data.find((x) => x && compareMedia(ctx.media, x.title, x.year))?.id;
  if (!mediaID) throw new NotFoundError('No watchable item found');

  ctx.progress(60);

  const data: { data: { list: { path: string; real_quality: string }[] } } = await ctx.proxiedFetcher(
    ctx.media.type === 'movie'
      ? `/movie/${mediaID}`
      : `/tv/${mediaID}/${ctx.media.season.number}/${ctx.media.episode.number}`,
    {
      baseUrl,
    },
  );

  const qualities = data.data.list.filter((x) => x.path && new URL(x.path).pathname.endsWith('mp4'));

  if (!qualities.length) throw new NotFoundError('No watchable item found');

  ctx.progress(80);

  const stream: Stream = {
    id: 'primary',
    flags: [flags.CORS_ALLOWED],
    captions: [],
    type: 'file',
    qualities: qualities.reduce<Partial<Record<Qualities, StreamFile>>>(
      (prev, x) => ({
        ...prev,
        [mapQuality(x.real_quality)]: {
          type: 'mp4',
          url: x.path,
        },
      }),
      {},
    ),
  };

  ctx.progress(90);

  return {
    embeds: [],
    stream: [stream],
  };
}

export const MBPApiScraper = makeSourcerer({
  id: 'mbp-api',
  name: 'MovieBoxPro',
  rank: 300,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
