/** Short, sourced rewards. No news fabrication, autoplay, scores or streaks. */
export type MovieReward = { id: string; title: string; text: string; source_url: string; source_label: string; category?: 'vfx' | 'sound' | 'performance' };
export const MOVIE_REWARDS: MovieReward[] = [
  {id:'smart-hulk-performance', category:'performance', title:'绿巨人的表情里，藏着谁的脸？',
    text:'《复仇者联盟4》的“聪明浩克”保留了马克·鲁法洛的表演。Marvel 的幕后短片请视效总监 Dan DeLeeuw 拆解了这次变身。',
    source_url:'https://www.marvel.com/articles/movies/how-vfx-transforms-mark-ruffalo-to-hulk-avengers-endgame?EML=072719_VFXHulk&cid=Editorial',source_label:'Marvel 官方幕后'},
  {id:'soul-real-fingering',category:'performance',title:'《心灵奇旅》的手指，真的在弹那些音',
    text:'动画师拍下 Jon Batiste 弹琴时的手，再逐帧制作 Joe 的指法。片中的爵士演奏，连手指和音乐都要对得上。',
    source_url:'https://news.disney.com/music-for-soul',source_label:'Disney 官方音乐幕后'},
  {id:'spiderverse-on-twos',category:'vfx',title:'蜘蛛侠的漫画感，有一个“少画一点”的秘密',
    text:'《平行宇宙》使用了每张画面保持两帧的动画方式，制造清脆的漫画节奏。这是风格选择，不是简单让整部电影少一半帧。',
    source_url:'https://www.imageworks.com/node/1371',source_label:'Sony Pictures Imageworks 制作解析'},
  {id:'soul-sax-reference',category:'performance',title:'萨克斯玩家，可以检查一下《心灵奇旅》',
    text:'Pixar 为爵士演出拍了多角度实演参考，特写不只拍钢琴手指，也拍萨克斯、贝斯和鼓。下次看片可以留意乐手的动作。',
    source_url:'https://www.pixar.com/soul',source_label:'Pixar 官方制作介绍'},
  {id:'spiderverse-drawn-fire',category:'vfx',title:'《平行宇宙》里的火，也混进了手绘',
    text:'特效团队建立了可复用的二维手绘素材库，再与三维模拟结合。爆炸和火焰的漫画感，并不只来自最后加的一层滤镜。',
    source_url:'https://www.imageworks.com/node/1371',source_label:'Sony Pictures Imageworks 制作解析'},
  {id:'spiderverse-face-lines',category:'performance',title:'迈尔斯脸上的线，也要“演戏”',
    text:'《平行宇宙》的面部线条并非静态贴图：艺术家画线，再把线变成能随表演运动的几何体。留意眉眼旁的小笔触，会发现另一层表情。',
    source_url:'https://www.imageworks.com/node/1371',source_label:'Sony Pictures Imageworks 制作解析'},
  {id:'spiderverse-print-focus',category:'vfx',title:'背景的重色边，可能是另一种“失焦”',
    text:'《平行宇宙》从漫画印刷的套色偏移寻找景深效果，替代传统镜头虚化。下次可以看看，远处轮廓是怎样散开的。',
    source_url:'https://www.imageworks.com/node/1371',source_label:'Sony Pictures Imageworks 制作解析'},
  {id:'spiderverse-extra-limbs',category:'vfx',title:'快动作里，多出来的手脚不是画错了',
    text:'为避免传统运动模糊，《平行宇宙》会拉伸形体、画速度线，甚至给角色加上多重肢体。清晰的漫画动作，也需要这些小把戏。',
    source_url:'https://www.imageworks.com/node/1371',source_label:'Sony Pictures Imageworks 制作解析'},
  {id:'soul-two-musical-worlds',category:'sound',title:'从纽约到灵魂世界，先换了耳朵',
    text:'《心灵奇旅》的纽约爵士由 Jon Batiste 创作与编配；Trent Reznor 和 Atticus Ross 负责包括生之来处在内的配乐。换场景时，听听音乐怎样先把你带走。',
    source_url:'https://news.disney.com/music-for-soul',source_label:'Disney 官方音乐幕后'},
  {id:'soul-barbershop-mirror',category:'performance',title:'理发椅朝哪边，也会改变一场戏',
    text:'《心灵奇旅》团队走访理发店时注意到：顾客背对镜子、朝着等候的人，更容易聊起来。片中的空间布置，也在帮助人物交谈。',
    source_url:'https://www.pixar.com/soul',source_label:'Pixar 官方场景研究'},
  {id:'coco-fictional-star-songs',category:'sound',title:'先为一个虚构歌星，写出他的歌',
    text:'为了让观众相信《寻梦环游记》里 Ernesto 的名气，Adrian Molina 与 Germaine Franco 为他创作歌曲。音乐也在告诉你：这是怎样的一位表演者。',
    source_url:'https://www.pixar.com/coco',source_label:'Pixar 官方音乐幕后'},
  {id:'coco-detachable-bones',category:'performance',title:'《寻梦环游记》的脊椎，也能单独演喜剧',
    text:'骷髅会拆开骨头做笑料，连脊椎都能散开。Pixar 因此需要让各块骨头独立活动；一个轻巧的笑点，背后可能是一套复杂的角色控制。',
    source_url:'https://www.pixar.com/coco',source_label:'Pixar 官方角色制作'},
  {id:'no-way-home-city-map',category:'vfx',title:'折叠纽约之前，先要把纽约搭出来',
    text:'《蜘蛛侠：英雄无归》的镜像城市使用 OpenStreetMap 数据确定建筑轮廓与高度，再补上地标和街面细节。最后，团队还得让这座城市能弯折。',
    source_url:'https://www.framestore.com/work/spider-man-no-way-home',source_label:'Framestore 官方视效解析'},
  {id:'walle-sound-credit',category:'sound',title:'下次看瓦力，留一点注意力给声音',
    text:'《机器人总动员》的声音设计师 Ben Burtt 同时担任声音剪辑与混音工作。可以试着只听一小段：哪些机械声让你觉得，它是在犹豫或好奇？这是一个观看小实验。',
    source_url:'https://www.skysound.com/projects/walle/',source_label:'Skywalker Sound 官方制作名单'},
  {id:'star-wars-sound-origin',category:'sound',title:'《星球大战》的声音故事，从一位设计师开始',
    text:'1975年，George Lucas 聘请 Ben Burtt 为《星球大战：新希望》设计声音。Skywalker Sound 的历史介绍，把这次合作视为自身的起点。',
    source_url:'https://www.skysound.com/who-we-are/about/',source_label:'Skywalker Sound 官方历史'},
];

/** Curated shared cards can grow without a code deployment; reject malformed data. */
export function movieRewardBank(value: unknown): MovieReward[] {
  const bank = new Map(MOVIE_REWARDS.map(card => [card.id, card]));
  if (!Array.isArray(value)) return [...bank.values()];
  for (const candidate of value.slice(0, 200)) {
    if (!candidate || typeof candidate !== "object") continue;
    const card = candidate as Record<string, unknown>;
    if (typeof card.id !== "string" || !card.id.trim() || card.id.length > 120 ||
      typeof card.title !== "string" || !card.title.trim() || card.title.length > 200 ||
      typeof card.text !== "string" || !card.text.trim() || card.text.length > 1200 ||
      typeof card.source_label !== "string" || !card.source_label.trim() || card.source_label.length > 150 ||
      typeof card.source_url !== "string" || card.source_url.length > 2000 ||
      !["vfx", "sound", "performance"].includes(String(card.category))) continue;
    try { const url = new URL(card.source_url); if (url.protocol !== "https:" || url.username || url.password) continue; } catch { continue; }
    if (!bank.has(card.id)) bank.set(card.id, { id: card.id, title: card.title, text: card.text, category: card.category as MovieReward["category"], source_label: card.source_label, source_url: card.source_url });
  }
  return [...bank.values()];
}
