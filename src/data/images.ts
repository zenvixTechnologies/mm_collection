/**
 * Central registry of product & editorial photography (Unsplash, free licence).
 * Every ID below was checked to resolve before being added.
 * Product shots are requested as 4:5 portrait crops so every card lines up.
 */

const BASE = "https://images.unsplash.com/photo-";

/** 4:5 portrait crop — the standard product image ratio across the site. */
export const portrait = (id: string) => `${BASE}${id}?ar=4:5&fit=crop`;

/** A zoomed detail crop of the same garment (fabric / neckline close-up). */
export const detail = (id: string, y = 0.42, zoom = 1.7) =>
  `${BASE}${id}?ar=4:5&fit=crop&crop=focalpoint&fp-x=0.5&fp-y=${y}&fp-z=${zoom}`;

/** Wide crop for banners. */
export const wide = (id: string, ar = "16:9") => `${BASE}${id}?ar=${ar}&fit=crop`;

export const IMG = {
  // Dresses
  whiteRuffleDress: "1515372039744-b8f02a3ae446",
  redFloralDress: "1572804013309-59a88b7e92f1",
  floralWrapDress: "1496747611176-843222e1e57c",
  blueMaxiDress: "1539008835657-9e8e9680c956",
  polkaDress: "1502716119720-b23a93e5fe1b",
  redSlipDress: "1542295669297-4d352b042bca",
  blushMaxiDress: "1499939667766-4afceb292d05",
  greySheathDress: "1617922001439-4a2e6562f328",
  mustardWrapDress: "1612722432474-b971cdcea546",
  denimShirtDress: "1591369822096-ffd140ec948f",
  blackKnitDress: "1550639525-c97d455acf70",
  laceDress: "1551803091-e20673f15770",
  // Tops
  embroideredShirt: "1564257631407-4deb1f99d992",
  crochetTop: "1434389677669-e08b4cac3105",
  stripedOffShoulder: "1503185912284-5271ff81b9a8",
  whiteBlouse: "1549062572-544a64fb0c56",
  sheerBlackTop: "1524504388940-b1c1722653e1",
  ruffleBlouse: "1581044777550-4cfa60707c03",
  whiteTeeJeans: "1598554747436-c9293d6a588f",
  graphicTee: "1503342217505-b0a15ec3261c",
  orangeKnitTop: "1578587018452-892bacefd3f2",
  // Ethnic
  greenKurti: "1597983073493-88cd35cf93b0",
  yellowKurta: "1605763240000-7e93b172d754",
  whiteAnarkali: "1583391733956-3750e0ff4e8b",
  greenFlowyKurta: "1609357605129-26f69add5d6e",
  blockPrintRack: "1525845859779-54d477ff291f",
  purpleSaree: "1610030469983-98e550d6193c",
  redSilkSaree: "1617627143750-d86bc21e42bb",
  goldGown: "1623609163859-ca93c959b98a",
  // Co-ords
  yellowCoord: "1515886657613-9f3515b0c78f",
  navyCoord: "1562572159-4efc207f5aff",
  brownCoord: "1614251055880-ee96e4803393",
  ivoryCoord: "1566206091558-7f218b696731",
  // Western / casual
  checkBlazer: "1485968579580-b6d095142e6e",
  whiteBlazer: "1571513722275-4b41940f54b8",
  tealJumpsuit: "1495385794356-15371f348c31",
  oliveRomper: "1618932260643-eee4a2f652a6",
  denimJacket: "1621184455862-c163dfb30e0f",
  shirtSkirt: "1583496661160-fb5886a0aaaa",
  // Party
  redGown: "1595777457583-95e059d581b8",
  plumGown: "1566174053879-31528523f8ae",
  sequinGown: "1568252542512-9fe8fe9c87bb",
  redPartyDress: "1612336307429-8a898d10e223",
  // Nightwear
  camisoles: "1525171254930-643fc658b64e",
  pinkJoggers: "1594633312681-425c7b97ccd1",
  fleeceJacket: "1621786030484-4c855eed6974",
  // Feeding wear
  burgundyShirtDress: "1585487000160-6ebcfceb0d03",
  whiteShirtDress: "1617019114583-affb34d1b3cd",
  pinkMaxi: "1596783074918-c84cb06531ca",
  // Editorial
  rackTops: "1490481651871-ab68de25d43d",
  boutique: "1445205170230-053b83016050",
  printRack: "1520006403909-838d6b92c22e",
  neutralRack: "1558769132-cb1aea458c5e",
  greenFieldDress: "1609357605129-26f69add5d6e",
} as const;

export type ImageKey = keyof typeof IMG;

/** Fallback shown when a remote image fails to load. */
export const FALLBACK_IMAGE = "/images/fallback.svg";
