import { Video, YouTube } from 'youtube-sr';

// prettier-ignore
import {
    BaseExtractor,
    ExtractorInfo,
    ExtractorSearchContext,
    type GuildQueueHistory,
    Playlist,
    QueryType,
    SearchQueryType,
    Track,
    Util,
    ExtractorStreamable
} from 'discord-player';

import { StreamFN, YouTubeLibs, loadYtdl, makeYTSearch } from './common/helper';
import type { Readable } from 'stream';

// taken from ytdl-core
const validQueryDomains = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'gaming.youtube.com']);
const validPathDomains = /^https?:\/\/(youtu\.be\/|(www\.)?youtube\.com\/(embed|v|shorts)\/)/;
const idRegex = /^[a-zA-Z0-9-_]{11}$/;

export interface YoutubeExtractorInit {
    createStream?: (ext: YoutubeExtractor, url: string) => Promise<Readable | string>;
}

export class YoutubeExtractor extends BaseExtractor<YoutubeExtractorInit> {
    public static identifier = 'com.discord-player.youtubeextractor' as const;
    public _stream!: StreamFN;
    public _ytLibName!: string;
    public static instance: YoutubeExtractor | null;

    public async activate() {
        const fn = this.options.createStream;

        if (typeof fn === 'function') {
            this._stream = (q: string) => {
                return fn(this, q);
            };
        } else {
            const { stream, name } = await loadYtdl(this.context.player.options.ytdlOptions);
            this._stream = stream;
            this._ytLibName = name;
        }

        YoutubeExtractor.instance = this;
    }

    public async deactivate(): Promise<void> {
        YoutubeExtractor.instance = null;
    }

    public async validate(query: string, type?: SearchQueryType | null | undefined): Promise<boolean> {
        if (typeof query !== 'string') return false;
        // prettier-ignore
        return ([
            QueryType.YOUTUBE,
            QueryType.YOUTUBE_PLAYLIST,
            QueryType.YOUTUBE_SEARCH,
            QueryType.YOUTUBE_VIDEO,
            QueryType.AUTO,
            QueryType.AUTO_SEARCH
        ] as SearchQueryType[]).some((r) => r === type);
    }

    public async handle(query: string, context: ExtractorSearchContext): Promise<ExtractorInfo> {
        query = query.includes('youtube.com') ? query.replace(/(m(usic)?|gaming)\./, '') : query;
        if (!query.includes('list=RD') && YoutubeExtractor.validateURL(query)) context.type = QueryType.YOUTUBE_VIDEO;

        switch (context.type) {
            case QueryType.YOUTUBE_PLAYLIST: {
                const ytpl = await YouTube.getPlaylist(query, {
                    fetchAll: true,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    limit: (context.requestOptions as any)?.limit,
                    requestOptions: context.requestOptions as unknown as RequestInit
                }).catch(Util.noop);
                if (!ytpl) return this.emptyResponse();

                const playlist = new Playlist(this.context.player, {
                    title: ytpl.title!,
                    thumbnail: ytpl.thumbnail?.displayThumbnailURL('maxresdefault') as string,
                    description: ytpl.title || '',
                    type: 'playlist',
                    source: 'youtube',
                    author: {
                        name: ytpl.channel!.name as string,
                        url: ytpl.channel!.url as string
                    },
                    tracks: [],
                    id: ytpl.id as string,
                    url: ytpl.url as string,
                    rawPlaylist: ytpl
                });

                playlist.tracks = ytpl.videos.map((video) => {
                    const track = new Track(this.context.player, {
                        title: video.title as string,
                        description: video.description as string,
                        author: video.channel?.name as string,
                        url: video.url,
                        requestedBy: context.requestedBy,
                        thumbnail: video.thumbnail!.url as string,
                        views: video.views,
                        duration: video.durationFormatted,
                        raw: video,
                        playlist: playlist,
                        source: 'youtube',
                        queryType: 'youtubeVideo',
                        metadata: video,
                        async requestMetadata() {
                            return video;
                        }
                    });

                    track.extractor = this;
                    track.playlist = playlist;
                    return track;
                });

                return { playlist, tracks: playlist.tracks };
            }
            case QueryType.YOUTUBE_VIDEO: {
                const id = /[a-zA-Z0-9-_]{11}/.exec(query);
                if (!id?.[0]) return this.emptyResponse();
                const video = await YouTube.getVideo(`https://www.youtube.com/watch?v=${id}`, context.requestOptions as unknown as RequestInit).catch(Util.noop);
                if (!video) return this.emptyResponse();

                // @ts-expect-error
                video.source = 'youtube';

                const track = new Track(this.context.player, {
                    title: video.title!,
                    description: video.description!,
                    author: video.channel?.name as string,
                    url: video.url,
                    requestedBy: context.requestedBy,
                    thumbnail: video.thumbnail?.displayThumbnailURL('maxresdefault') as string,
                    views: video.views,
                    duration: video.durationFormatted,
                    source: 'youtube',
                    raw: video,
                    queryType: context.type,
                    metadata: video,
                    async requestMetadata() {
                        return video;
                    }
                });

                track.extractor = this;

                return {
                    playlist: null,
                    tracks: [track]
                };
            }
            default: {
                const tracks = await this._makeYTSearch(query, context);
                return { playlist: null, tracks };
            }
        }
    }

    private async _makeYTSearch(query: string, context: ExtractorSearchContext) {
        const res = await makeYTSearch(query, context.requestOptions).catch(Util.noop);
        if (!res || !res.length) return [];

        return res.map((video) => {
            // @ts-expect-error
            video.source = 'youtube';

            const track = new Track(this.context.player, {
                title: video.title!,
                description: video.description!,
                author: video.channel?.name as string,
                url: video.url,
                requestedBy: context.requestedBy,
                thumbnail: video.thumbnail?.displayThumbnailURL('maxresdefault') as string,
                views: video.views,
                duration: video.durationFormatted,
                source: 'youtube',
                raw: video,
                queryType: context.type!,
                metadata: video,
                async requestMetadata() {
                    return video;
                }
            });

            track.extractor = this;

            return track;
        });
    }

    public async getRelatedTracks(track: Track, history: GuildQueueHistory) {
        let info: Video[] | void = undefined;

        if (YoutubeExtractor.validateURL(track.url))
            info = await YouTube.getVideo(track.url)
                .then((x) => x.videos)
                .catch(Util.noop);

        // fallback
        if (!info)
            info = await YouTube.search(track.author || track.title, { limit: 5, type: 'video' })
                .then((x) => x)
                .catch(Util.noop);

        if (!info?.length) {
            return this.createResponse();
        }

        const unique = info.filter((t) => !history.tracks.some((x) => x.url === t.url));

        const similar = (unique.length > 0 ? unique : info).map((video) => {
            const t = new Track(this.context.player, {
                title: video.title!,
                url: `https://www.youtube.com/watch?v=${video.id}`,
                duration: video.durationFormatted || Util.buildTimeCode(Util.parseMS(video.duration * 1000)),
                description: video.title!,
                thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail! : video.thumbnail!.url!,
                views: video.views,
                author: video.channel!.name!,
                requestedBy: track.requestedBy,
                source: 'youtube',
                queryType: 'youtubeVideo',
                metadata: video,
                async requestMetadata() {
                    return video;
                }
            });

            t.extractor = this;

            return t;
        });

        return this.createResponse(null, similar);
    }

    public emptyResponse(): ExtractorInfo {
        return { playlist: null, tracks: [] };
    }

    public async stream(info: Track): Promise<ExtractorStreamable> {
        if (!this._stream) {
            throw new Error(`Could not find youtube streaming library. Install one of ${YouTubeLibs.join(', ')}`);
        }

        let url = info.url;
        url = url.includes('youtube.com') ? url.replace(/(m(usic)?|gaming)\./, '') : url;

        return this._stream(url, this, this.supportsDemux);
    }

    public static validateURL(link: string) {
        try {
            YoutubeExtractor.parseURL(link);
            return true;
        } catch {
            return false;
        }
    }

    public static validateId(id: string) {
        return idRegex.test(id.trim());
    }

    public static parseURL(link: string) {
        const parsed = new URL(link.trim());
        let id = parsed.searchParams.get('v');
        if (validPathDomains.test(link.trim()) && !id) {
            const paths = parsed.pathname.split('/');
            id = parsed.host === 'youtu.be' ? paths[1] : paths[2];
        } else if (parsed.hostname && !validQueryDomains.has(parsed.hostname)) {
            throw Error('Not a YouTube domain');
        }
        if (!id) {
            throw Error(`No video id found: "${link}"`);
        }
        id = id.substring(0, 11);
        if (!this.validateId(id)) {
            throw TypeError(`Video id (${id}) does not match expected ` + `format (${idRegex.toString()})`);
        }
        return id;
    }
}

export { YoutubeExtractor as YouTubeExtractor };
