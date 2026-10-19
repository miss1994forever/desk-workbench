import { FILM_EDITORIAL } from './film-editorial';
/** Editorial dates are personal viewing discoveries, never release dates or required viewing. */
export type FilmChapter = { id: string; title: string; subtitle: string; from: string; to: string; media_title: string; media_type: '电影' | '剧集' | '动画' | '漫画'; accent: string; poster_url?: string; source_url: string };
export type FilmDailyCard = { id: string; date: string; chapter_id: string; category: 'vfx' | 'sound' | 'performance'; kind: 'fact' | 'watch_prompt' | 'on_this_day'; title: string; text: string; source_label: string; source_url: string; film_title?: string; topic?: string; post_note?: string };
export const FILM_SEASON = { id: '2026-autumn', from: '2026-10-19', through: '2026-12-16', anchor_label: '本期电影小卡' } as const;
export const FILM_CHAPTERS: FilmChapter[] = [
  {id:'iron',title:'实拍与数字之间',subtitle:'沙丘、钢铁侠与隐形特效',from:'2026-10-19',to:'2026-10-25',media_title:'Dune × Iron Man',media_type:'电影',accent:'#ad493d',poster_url:"https://www.ilm.com/wp-content/uploads/2015/05/iron_man_thumb.jpg",source_url:'https://www.ilm.com/vfx/iron-man/'},
  {id:'spider',title:'漫画跳进了画面',subtitle:'蜘蛛侠的线条、速度与纽约',from:'2026-10-26',to:'2026-11-01',media_title:'Spider-Man: Into the Spider-Verse',media_type:'动画',accent:'#b74357',poster_url:"https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_001.jpg",source_url:'https://www.imageworks.com/node/1371'},
  {id:'guardians',title:'让数字角色可信',subtitle:'毛发、表演与环境制作',from:'2026-11-02',to:'2026-11-08',media_title:'Guardians of the Galaxy',media_type:'电影',accent:'#8270a5',poster_url:"https://www.framestore.com/sites/default/files/2023-11/Guardians-Galaxy-Case-Study-Header-1980x820.jpg",source_url:'https://www.framestore.com/work/guardians-galaxy'},
  {id:'strange',title:'空间如何被重建',subtitle:'魔法、城市与现场拍摄',from:'2026-11-09',to:'2026-11-15',media_title:'Doctor Strange × Dune',media_type:'电影',accent:'#658e87',poster_url:"https://framestore.com/sites/default/files/2025-02/Doctor-Strange-Case-Study-Header-1980x820.jpg",source_url:'https://framestore.com/work/doctor-strange'},
  {id:'panther',title:'声音与角色',subtitle:'黑豹、心灵奇旅与寻梦环游记',from:'2026-11-16',to:'2026-11-22',media_title:'Black Panther',media_type:'电影',accent:'#8869a0',poster_url:"https://lumiere-a.akamaihd.net/v1/images/p_blackpanther_19754_4ac13f07.jpeg?region=0%2C0%2C540%2C810",source_url:'https://www.marvel.com/movies/black-panther'},
  {id:'television',title:'电视里藏着另一个宇宙',subtitle:'WandaVision 与 Loki 的声音和空间',from:'2026-11-23',to:'2026-11-29',media_title:'WandaVision × Loki',media_type:'剧集',accent:'#ba7a63',poster_url:"https://lumiere-a.akamaihd.net/v1/images/wvo0360_101_comp_v013_r709_v02_947d09cd.jpeg?region=399%2C0%2C2157%2C2160",source_url:'https://www.marvel.com/tv-shows/wandavision/1'},
  {id:'mutants',title:'风格与创作选择',subtitle:'X战警97、瞬息全宇宙与剪辑',from:'2026-11-30',to:'2026-12-06',media_title:'X-Men ’97 × Everything Everywhere All at Once',media_type:'动画',accent:'#d1a544',poster_url:"https://d23.com/app/uploads/2024/03/1180w_600h_032024_X-Men-97-Disney-Twenty-Three-Extras_00.jpg",source_url:'https://www.marvel.com/comics/series/37723/x-men_97_2024_-_present'},
  {id:'avengers',title:'把表演变成数字角色',subtitle:'浩克、咕噜与数字皮肤',from:'2026-12-07',to:'2026-12-13',media_title:'The Avengers × Avengers: Endgame',media_type:'电影',accent:'#637d9b',poster_url:"https://www.ilm.com/wp-content/uploads/2015/04/thumb_avengers.jpg",source_url:'https://www.ilm.com/vfx/avengers-endgame/'},
  {id:'closing',title:'尺度、光与动作',subtitle:'雷神3：动作编排、雷电与石头角色',from:'2026-12-14',to:'2026-12-16',media_title:'Thor: Ragnarok · 雷神索尔',media_type:'电影',accent:'#c7473a',poster_url:"https://lumiere-a.akamaihd.net/v1/images/p_thorragnarok_19888_57cddf58.jpeg?region=0%2C0%2C540%2C810",source_url:'https://movies.disney.com/thor-ragnarok'},
];
export const FILM_DAYS: FilmDailyCard[] = FILM_EDITORIAL.map((entry, index) => {
  const date = new Date(Date.parse(`${FILM_SEASON.from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10);
  const chapter = FILM_CHAPTERS.find(item => date >= item.from && date <= item.to);
  if (!chapter) throw new Error('film_editorial_outside_season');
  return { ...entry, id: `film-${date.replaceAll('-', '')}`, date, chapter_id: chapter.id, kind: 'fact' };
});
/** Beijing calendar date regardless of the device's own timezone. */
export function beijingDay(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('invalid_date');
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
/** Zero-based season index. Outside the season, or an unprepared day, returns null. */
export function filmForDay(dateString: string): { chapter: FilmChapter; card: FilmDailyCard; index: number; daysTotal: 59; range: 'within' } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || dateString < FILM_SEASON.from || dateString > FILM_SEASON.through) return null;
  const card = FILM_DAYS.find(item => item.date === dateString);
  const chapter = card && FILM_CHAPTERS.find(item => item.id === card.chapter_id);
  if (!card || !chapter) return null;
  return { chapter, card, index: Math.round((Date.parse(`${dateString}T00:00:00Z`) - Date.parse(`${FILM_SEASON.from}T00:00:00Z`)) / 86400000), daysTotal: 59, range: 'within' };
}

export type FilmImage = { url: string; source_url: string };
/** Official picture pools. A dated card keeps the same picture on every device; pools repeat. */
const FILM_IMAGE_POOLS: Record<string, FilmImage[]> = {
  "iron": [
    {
      "url": "https://www.ilm.com/wp-content/uploads/2015/05/iron_man_thumb.jpg",
      "source_url": "https://www.ilm.com/vfx/iron-man/"
    },
    {
      "url": "https://www.ilm.com/wp-content/uploads/2015/05/iron_man_2_thumb1.jpg",
      "source_url": "https://www.ilm.com/vfx/iron-man-2/"
    }
  ],
  "spider": [
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_0000.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_001.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_001.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_006_0.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_013.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_010.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    },
    {
      "url": "https://www.imageworks.com/sites/default/files/inline-images/spi_intospiderverse_website_content_003.jpg",
      "source_url": "https://www.imageworks.com/node/1371"
    }
  ],
  "guardians": [
    {
      "url": "https://www.framestore.com/sites/default/files/2023-11/Guardians-Galaxy-Case-Study-Header-1980x820.jpg",
      "source_url": "https://www.framestore.com/work/guardians-galaxy"
    },
    {
      "url": "https://www.framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/guardians%20of%20the%20galaxy%20image.webp?itok=kIzTu1eY",
      "source_url": "https://www.framestore.com/work/guardians-galaxy"
    },
    {
      "url": "https://www.framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/guardians%20of%20the%20galaxy%20header%20image.webp?itok=ndL_xaqt",
      "source_url": "https://www.framestore.com/work/guardians-galaxy"
    },
    {
      "url": "https://www.framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/guardians%20of%20the%20galaxy%20image%202.webp?itok=fLh7EdRQ",
      "source_url": "https://www.framestore.com/work/guardians-galaxy"
    }
  ],
  "strange": [
    {
      "url": "https://framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/doctor%20strange%20image.webp?itok=J2DvqQFM",
      "source_url": "https://framestore.com/work/doctor-strange"
    },
    {
      "url": "https://framestore.com/sites/default/files/styles/image_gallery_mob_688x_387_/public/2022-07/doctor%20strange%20image%204.webp?h=4ffac15b&itok=fSzb4l_j",
      "source_url": "https://framestore.com/work/doctor-strange"
    },
    {
      "url": "https://framestore.com/sites/default/files/styles/image_gallery_mob_688x_387_/public/2022-07/doctor%20strange%20image%205.webp?h=4ffac15b&itok=PM4B-vaH",
      "source_url": "https://framestore.com/work/doctor-strange"
    },
    {
      "url": "https://framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/doctor%20strange%20image%206.webp?itok=B7bEKWhJ",
      "source_url": "https://framestore.com/work/doctor-strange"
    },
    {
      "url": "https://framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/doctor%20strange%20image%207.webp?itok=lSLzSlIY",
      "source_url": "https://framestore.com/work/doctor-strange"
    },
    {
      "url": "https://framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/doctor%20strange%20image%208.webp?itok=Moy0cBI0",
      "source_url": "https://framestore.com/work/doctor-strange"
    }
  ],
  "panther": [
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_01_68bbfb0f.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_02_e99059b8.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_09_3b300ad7.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_08_79aeb0cf.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_03_3fadd35f.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_07_e0c0281c.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_blackpanther_06_5d4ca6f1.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/black-panther"
    }
  ],
  "television": [
    {
      "url": "https://d23.com/app/uploads/2021/01/1180w-600h-012121_WandaVision-Matt-Shakman-iris.jpg",
      "source_url": "https://d23.com/the-magic-story-behind-dick-van-dykes-influence-on-wandavision/"
    },
    {
      "url": "https://d23.com/app/uploads/2021/01/780w-463h-012121_WandaVision-Matt-Shakman-01.jpg",
      "source_url": "https://d23.com/the-magic-story-behind-dick-van-dykes-influence-on-wandavision/"
    },
    {
      "url": "https://d23.com/app/uploads/2021/01/780w-463h-012121_WandaVision-Matt-Shakman-02.jpg",
      "source_url": "https://d23.com/the-magic-story-behind-dick-van-dykes-influence-on-wandavision/"
    },
    {
      "url": "https://d23.com/app/uploads/2021/01/780w-463h-012121_WandaVision-Matt-Shakman-03.jpg",
      "source_url": "https://d23.com/the-magic-story-behind-dick-van-dykes-influence-on-wandavision/"
    }
  ],
  "mutants": [
    {
      "url": "https://d23.com/app/uploads/2024/03/1180w_600h_032024_X-Men-97-Disney-Twenty-Three-Extras_00.jpg",
      "source_url": "https://d23.com/behind-the-scenes-of-marvel-animations-x-men-97/"
    },
    {
      "url": "https://d23.com/app/uploads/2024/03/1180w_600h_032024_X-Men-97-Disney-Twenty-Three-Extras_01.jpg",
      "source_url": "https://d23.com/behind-the-scenes-of-marvel-animations-x-men-97/"
    },
    {
      "url": "https://d23.com/app/uploads/2024/03/1180w_600h_032024_X-Men-97-Disney-Twenty-Three-Extras_02.jpg",
      "source_url": "https://d23.com/behind-the-scenes-of-marvel-animations-x-men-97/"
    }
  ],
  "avengers": [
    {
      "url": "https://www.ilm.com/wp-content/uploads/2015/04/thumb_avengers.jpg",
      "source_url": "https://www.ilm.com/vfx/marvels-the-avengers/"
    },
    {
      "url": "https://www.ilm.com/wp-content/uploads/2023/06/crs1140.comp_.077355.abain_v27.1268-aspect-ratio-654-334.jpg",
      "source_url": "https://www.ilm.com/vfx/avengers-endgame/"
    }
  ],
  "closing": [
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_thorragnarok_01_e1e06417.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/thor-ragnarok"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_thorragnarok_02_305ca4cd.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/thor-ragnarok"
    },
    {
      "url": "https://lumiere-a.akamaihd.net/v1/images/g_thorragnarok_03_706cfe86.jpeg?region=0%2C0%2C1200%2C560",
      "source_url": "https://movies.disney.com/thor-ragnarok"
    }
  ]
};
/** Match the actual film, never borrow an unrelated picture from its chapter. */
export function filmImageForCard(card: Pick<FilmDailyCard, "chapter_id" | "date">): FilmImage | null {
  const actual = FILM_DAYS.find(item => item.date === card.date && item.chapter_id === card.chapter_id);
  if (!actual) return null;
  if (actual.film_title === '沙丘') return { url: 'https://www.foundry.com/sites/default/files/2022-06/Dune%20Case%20Study%20Header.jpg', source_url: 'https://colorway.foundry.com/insights/film-tv/how-dneg-created-vfx-of-dune' };
  if (actual.date === '2026-12-16') return { url: 'https://www.framestore.com/sites/default/files/styles/full_width_688_x_variable_height/public/2022-07/thor%20ragnarok%20image%202.jpg?itok=s_GPf3hN', source_url: 'https://www.framestore.com/work/thor-ragnarok' };
  const key = ({ '钢铁侠': 'iron', '蜘蛛侠：平行宇宙': 'spider', '银河护卫队': 'guardians', '奇异博士': 'strange', '黑豹': 'panther', '旺达幻视': 'television', 'X战警97': 'mutants', '复仇者联盟4：终局之战': 'avengers', '雷神3：诸神黄昏': 'closing' } as Record<string, string>)[actual.film_title || ''];
  let pool = key ? FILM_IMAGE_POOLS[key] : undefined;
  if (key === 'iron') pool = pool?.slice(0, 1);
  if (key === 'avengers') pool = pool?.slice(1);
  if (!pool?.length) return null;
  const index = FILM_DAYS.filter(item => item.film_title === actual.film_title).findIndex(item => item.date === card.date);
  return pool[index % pool.length];
}
