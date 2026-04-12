export type WorkShowcaseItem = {
  id: string;
  title: string;
  /** 与 Hero 一致：`/vidsrc/...`（可用中文文件名，UTF-8） */
  video: string;
  /** 由 npm run works:showcase 自 vidsrc 截取 */
  poster: string;
  /** 由 ffprobe 推断 */
  ratio: string;
};

/**
 * 由 scripts/generate-works-showcase.ts 根据 public/vidsrc 生成，勿手改条目（可改脚本后重跑）。
 */
export const WORKS_SHOWCASE: readonly WorkShowcaseItem[] = [
  {
    id: "v01",
    title: "Hero",
    video: "/vidsrc/Hero.mp4",
    poster: "/pic/works-v01.jpg",
    ratio: "16:9",
  },
  {
    id: "v02",
    title: "1：1神经网络",
    video: "/vidsrc/1：1神经网络.mp4",
    poster: "/pic/works-v02.jpg",
    ratio: "1:1",
  },
  {
    id: "v03",
    title: "4：3神经网络",
    video: "/vidsrc/4：3神经网络.mp4",
    poster: "/pic/works-v03.jpg",
    ratio: "4:3",
  },
  {
    id: "v04",
    title: "神经网络粉色版本",
    video: "/vidsrc/神经网络粉色版本.mp4",
    poster: "/pic/works-v04.jpg",
    ratio: "9:16",
  },
  {
    id: "v05",
    title: "数据规模",
    video: "/vidsrc/数据规模.mp4",
    poster: "/pic/works-v05.jpg",
    ratio: "16:9",
  },
  {
    id: "v06",
    title: "治愈风格",
    video: "/vidsrc/治愈风格.mp4",
    poster: "/pic/works-v06.jpg",
    ratio: "16:9",
  },
  {
    id: "v07",
    title: "Coqui",
    video: "/vidsrc/Coqui.mp4",
    poster: "/pic/works-v07.jpg",
    ratio: "16:9",
  },
  {
    id: "v08",
    title: "Crew Ai",
    video: "/vidsrc/Crew Ai.mp4",
    poster: "/pic/works-v08.jpg",
    ratio: "4:3",
  },
  {
    id: "v09",
    title: "pic",
    video: "/vidsrc/pic.mp4",
    poster: "/pic/works-v09.jpg",
    ratio: "9:16",
  },
  {
    id: "v10",
    title: "scs",
    video: "/vidsrc/scs.mp4",
    poster: "/pic/works-v10.jpg",
    ratio: "16:9",
  },
  {
    id: "v11",
    title: "university",
    video: "/vidsrc/university.mp4",
    poster: "/pic/works-v11.jpg",
    ratio: "16:9",
  },
];
