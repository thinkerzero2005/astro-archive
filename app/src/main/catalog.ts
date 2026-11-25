/** 常用深空天体的内置资料，用于目标首次扫描时补全天体名片。数值为常用参考值。 */
export interface BuiltinProfile {
  nameEn: string
  alias: string
  objectType: string
  constellation: string
  distanceLy: number | null
  magnitude: number | null
  description: string
}

const CATALOG: Record<string, BuiltinProfile> = {
  IC434: {
    nameEn: 'Horsehead Nebula',
    alias: '马头星云、B33',
    objectType: '暗星云',
    constellation: '猎户座',
    distanceLy: 1500,
    magnitude: null,
    description:
      '马头星云本身是一团浓密的暗尘埃云，编号 B33，因为背后有 IC 434 的红色发射星云衬托，才显出马头状的剪影。它位于猎户座腰带最东侧恒星参宿一附近，距离约 1500 光年。肉眼不可见，需要长焦配合长时间曝光才能拍到。'
  },
  M42: {
    nameEn: 'Orion Nebula',
    alias: '猎户座大星云、NGC 1976',
    objectType: '发射星云',
    constellation: '猎户座',
    distanceLy: 1344,
    magnitude: 4,
    description:
      '猎户座大星云是离我们最近的大质量恒星形成区，距离约 1344 光年。肉眼在猎户座腰带下方就能看到一小团朦胧光斑，用双筒望远镜可以分辨出更多结构。它是深空摄影最经典的入门与进阶目标之一。'
  },
  M16: {
    nameEn: 'Eagle Nebula',
    alias: '鹰状星云、创生之柱、NGC 6611',
    objectType: '发射星云',
    constellation: '巨蛇座',
    distanceLy: 5700,
    magnitude: 6,
    description:
      '鹰状星云位于巨蛇座，距离约 5700 光年，是著名的恒星形成区。中心那几根被紫外辐射雕刻出来的柱状尘埃云被称为「创生之柱」，新恒星正在其中孕育。夏季银河中段最上镜的目标之一，适合中长焦配合窄带拍摄。'
  },
  M65: {
    nameEn: 'Leo Triplet',
    alias: '狮子座三重星系、M66、NGC 3628',
    objectType: '星系群',
    constellation: '狮子座',
    distanceLy: 35000000,
    magnitude: 8.9,
    description:
      '狮子座三重星系由 M65、M66 和 NGC 3628 三个旋涡星系组成，距离约 3500 万光年。三者在天空中相距不到 1 度，一支中长焦镜头就能同框：M65 与 M66 是正面朝向我们的旋涡星系，NGC 3628 则以侧面对着地球，形态最容易区分。春季前半夜位于狮子座后腿附近，是春季深空摄影的经典目标。'
  },
  M45: {
    nameEn: 'Pleiades',
    alias: '昴星团、七姊妹星团',
    objectType: '疏散星团',
    constellation: '金牛座',
    distanceLy: 444,
    magnitude: 1.6,
    description:
      '昴星团是一个年轻的疏散星团，俗称七姊妹星团，距离约 444 光年。肉眼通常能看到六到七颗成员星，长时间曝光能拍出周围淡蓝色的反射星云。它是秋冬夜空中最容易辨认的深空目标之一。'
  },
  NGC1499: {
    nameEn: 'California Nebula',
    alias: '加州星云、Sh2-220',
    objectType: '发射星云',
    constellation: '英仙座',
    distanceLy: 1000,
    magnitude: 6,
    description:
      '加州星云是一条狭长的发射星云，轮廓酷似美国加州地图，距离约 1000 光年。它的表面亮度很低，肉眼几乎看不到，适合用广角镜头配合窄带滤镜长时间曝光。位于英仙座，秋季后半夜升起。'
  },
  NGC7000: {
    nameEn: 'North America Nebula',
    alias: '北美洲星云、C20',
    objectType: '发射星云',
    constellation: '天鹅座',
    distanceLy: 2600,
    magnitude: 4,
    description:
      '北美洲星云因轮廓酷似北美大陆而得名，距离约 2600 光年。它与旁边的鹈鹕星云 IC 5070 实际上属于同一片巨大的电离氢区。表面亮度偏低，适合广角镜头配合窄带滤镜或改机长时间曝光。'
  },
  IC5070: {
    nameEn: 'Pelican Nebula',
    alias: '鹈鹕星云',
    objectType: '发射星云',
    constellation: '天鹅座',
    distanceLy: 1800,
    magnitude: 8,
    description:
      '鹈鹕星云紧邻北美洲星云，两者被一片暗尘埃带分隔，距离约 1800 光年。它同样是一片活跃的恒星形成区，表面亮度低，窄带拍摄更容易呈现细节。'
  },
  IC1805: {
    nameEn: 'Heart Nebula',
    alias: '心脏星云、Sh2-190',
    objectType: '发射星云',
    constellation: '仙后座',
    distanceLy: 7500,
    magnitude: 6.5,
    description:
      '心脏星云是一片巨大的发射星云，因形似心脏而得名，距离约 7500 光年。星云中心是年轻的疏散星团 Melotte 15，其恒星风与辐射雕刻出了周围的云气。适合广角窄带拍摄。'
  },
  M31: {
    nameEn: 'Andromeda Galaxy',
    alias: '仙女座星系、仙女座大星系、NGC 224',
    objectType: '旋涡星系',
    constellation: '仙女座',
    distanceLy: 2540000,
    magnitude: 3.4,
    description:
      '距离银河系最近的大型旋涡星系，也是肉眼可见的最远天体之一。在黑暗环境下用肉眼就能看到一小团模糊光斑，用双筒望远镜即可分辨出明亮的核心。它正以每秒约 110 公里的速度接近银河系。'
  },
  M33: {
    nameEn: 'Triangulum Galaxy',
    alias: '三角座星系、NGC 598',
    objectType: '旋涡星系',
    constellation: '三角座',
    distanceLy: 2730000,
    magnitude: 5.7,
    description:
      '三角座星系是本星系群中第三大的成员，距离约 273 万光年。它的表面亮度低，肉眼观测条件要求较高，适合广角或中焦镜头累积曝光。'
  },
  M51: {
    nameEn: 'Whirlpool Galaxy',
    alias: '涡状星系、NGC 5194',
    objectType: '旋涡星系',
    constellation: '猎犬座',
    distanceLy: 23000000,
    magnitude: 8.4,
    description:
      '涡状星系是最早被辨认出旋涡结构的星系之一，距离约 2300 万光年。它正与伴星系 NGC 5195 发生引力相互作用，旋臂结构在长焦照片中非常上镜。'
  },
  M81: {
    nameEn: "Bode's Galaxy",
    alias: '波德星系、NGC 3031',
    objectType: '旋涡星系',
    constellation: '大熊座',
    distanceLy: 11800000,
    magnitude: 6.9,
    description:
      '波德星系是 M81 星系群中最明亮的成员，距离约 1180 万光年。它与附近的 M82 雪茄星系在同一片天区，常用中长焦一次拍到两个目标。'
  },
  M13: {
    nameEn: 'Hercules Cluster',
    alias: '武仙座球状星团、NGC 6205',
    objectType: '球状星团',
    constellation: '武仙座',
    distanceLy: 22200,
    magnitude: 5.8,
    description:
      '武仙座球状星团是北天最明亮的球状星团，包含数十万颗恒星，距离约 2.2 万光年。小望远镜即可分辨出外围恒星，是夏季深空摄影的常见目标。'
  },
  M27: {
    nameEn: 'Dumbbell Nebula',
    alias: '哑铃星云、NGC 6853',
    objectType: '行星状星云',
    constellation: '狐狸座',
    distanceLy: 1360,
    magnitude: 7.4,
    description:
      '哑铃星云是一颗类太阳恒星抛出的外层气体，因形状像哑铃而得名，距离约 1360 光年。它的表面亮度较高，适合小口径设备拍摄，也是窄带与彩色合成的好练习目标。'
  },
  M57: {
    nameEn: 'Ring Nebula',
    alias: '环状星云、NGC 6720',
    objectType: '行星状星云',
    constellation: '天琴座',
    distanceLy: 2300,
    magnitude: 8.8,
    description:
      '环状星云位于天琴座，是行星状星云的经典样本，距离约 2300 光年。中心白矮星的高能辐射让外围气壳发光，长焦下能看到明显的甜甜圈轮廓。'
  }
}

export function normalizeCatalogId(id: string) {
  return String(id ?? '')
    .toUpperCase()
    .replace(/[\s_]+/g, '')
}

export function builtinProfile(catalogId: string): BuiltinProfile | null {
  return CATALOG[normalizeCatalogId(catalogId)] ?? null
}

/** 英文俗名 → 编号，例如 Eagle Nebula → M16；用于识别 Dwarf 水印里的英文目标名 */
export function catalogIdByEnglishName(name: string): string | null {
  const key = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!key) return null
  for (const [id, profile] of Object.entries(CATALOG)) {
    const en = profile.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (en === key) return id
  }
  return null
}
