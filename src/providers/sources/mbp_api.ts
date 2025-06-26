import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';
import { Qualities, StreamFile } from '../streams';
import { removeDuplicatedLanguages } from '../captions';

const API_SERVER = 'https://mbp.pirxcy.dev/';

type Predicate<T> = (item: T, index: number, items: T[]) => Promise<boolean>;

const any = async <T>(array: T[], predicate: Predicate<T>): Promise<T> => {
  return Promise.any(
    array.map(async (item, index, items) => {
      if (await predicate(item, index, items)) {
        return item;
      }

      throw new Error();
    }),
  );
};

function getBestQuality(qualities: Partial<Record<Qualities, Stream>>): Qualities {
  if (qualities['4k']) return '4k';
  if (qualities['1080']) return '1080';
  if (qualities['720']) return '720';
  if (qualities['480']) return '480';
  if (qualities['360']) return '360';
  return 'unknown';
}

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
type Stream = { path: string; real_quality: string; fid: number };

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const searchResults: { data: { id: number }[] } = await ctx.fetcher('/search', {
    baseUrl: API_SERVER,
    query: {
      q: ctx.media.title,
      type: ctx.media.type === 'movie' ? 'movie' : 'tv',
      year: ctx.media.releaseYear.toString(),
    },
  });

  ctx.progress(40);

  const mediaID = (
    await any(searchResults.data, async (result) => {
      const detailResults: { data: { tmdb_id: number } } = await ctx.fetcher(
        `/details/${ctx.media.type === 'movie' ? 'movie' : 'tv'}/${result.id}`,
        {
          baseUrl: API_SERVER,
        },
      );
      return detailResults.data.tmdb_id.toString() === ctx.media.tmdbId;
    })
  )?.id;
  if (!mediaID) throw new NotFoundError('No watchable item found');

  ctx.progress(70);

  const data: { data: { list: Stream[] } } = await ctx.fetcher(
    ctx.media.type === 'movie'
      ? `/movie/${mediaID}`
      : `/tv/${mediaID}/${ctx.media.season.number}/${ctx.media.episode.number}`,
    {
      baseUrl: API_SERVER,
    },
  );

  const qualities = data.data.list
    .filter((x) => x.path && new URL(x.path).pathname.endsWith('.mp4'))
    .reduce<Partial<Record<Qualities, Stream>>>(
      (prev, x) => ({
        ...prev,
        [mapQuality(x.real_quality)]: x,
      }),
      {},
    );

  if (!Object.keys(qualities).length) throw new NotFoundError('No watchable item found');

  ctx.progress(80);

  const bestStreamId = qualities[getBestQuality(qualities)]!.fid;

  const subtitles: { data: { list: { subtitles: { file_path: string; lang: string; sid: number }[] }[] } } =
    await ctx.fetcher(
      `/subtitles/${
        ctx.media.type === 'movie'
          ? `movie/${mediaID}`
          : `tv/${mediaID}/${ctx.media.season.number}/${ctx.media.episode.number}`
      }/${bestStreamId}`,
      {
        baseUrl: API_SERVER,
      },
    );

  const flatSubtitles = subtitles.data.list.flatMap((x) => x.subtitles);

  return {
    embeds: [],
    stream: [
      {
        id: 'primary',
        flags: [flags.CORS_ALLOWED],
        captions: removeDuplicatedLanguages(
          flatSubtitles.map((x) => ({
            type: 'srt',
            id: x.sid.toString(),
            hasCorsRestrictions: true,
            url: x.file_path,
            language: x.lang,
          })),
        ),
        type: 'file',
        qualities: Object.keys(qualities).reduce<Partial<Record<Qualities, StreamFile>>>(
          (prev, x) => ({
            ...prev,
            [x]: {
              type: 'mp4',
              url: qualities[x as Qualities]!.path,
            },
          }),
          {},
        ),
      },
    ],
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
