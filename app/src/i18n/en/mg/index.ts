// English for the mini games, one file per game so parallel edits never collide.
import { EN_BALAP_DRONE } from './balap-drone';
import { EN_TARUNG_KANTOR } from './tarung-kantor';
import { EN_LOMPAT_LANTAI } from './lompat-lantai';
import { EN_SAMBUNG_KABEL } from './sambung-kabel';
import { EN_ARENA_BOM } from './arena-bom';
import { EN_LARI_PAGI } from './lari-pagi';
import { EN_ANGKAT_BEBAN } from './angkat-beban';
import { EN_PEREGANGAN } from './peregangan';
import { EN_BILIAR } from './biliar';
import { EN_BARISTA } from './barista';
import { EN_SERVER_DOWN } from './server-down';
import { EN_SUSUN_DENAH } from './susun-denah';
import { EN_DESAIN_POSTER } from './desain-poster';
import { EN_KUIS_PERPUSTAKAAN } from './kuis-perpustakaan';
import { EN_CATUR } from './catur';
import { EN_BOLA_MEJA } from './bola-meja';
import { EN_ULAR_KABEL } from './ular-kabel';
import { EN_TEKNISI_KILAT } from './teknisi-kilat';
import { EN_LOMBA_17AN } from './lomba-17an';
import { EN_HOKI_MEJA } from './hoki-meja';
import { EN_MG_HOST } from './host';
import { EN_MG_OFFICE } from './office';

export const EN_MG: Record<string, string> = {
  ...EN_MG_HOST,
  ...EN_BOLA_MEJA,
  ...EN_ULAR_KABEL,
  ...EN_TEKNISI_KILAT,
  ...EN_LOMBA_17AN,
  ...EN_HOKI_MEJA,
  ...EN_CATUR,
  ...EN_MG_OFFICE,
  ...EN_BALAP_DRONE,
  ...EN_TARUNG_KANTOR,
  ...EN_LOMPAT_LANTAI,
  ...EN_SAMBUNG_KABEL,
  ...EN_ARENA_BOM,
  ...EN_LARI_PAGI,
  ...EN_ANGKAT_BEBAN,
  ...EN_PEREGANGAN,
  ...EN_BILIAR,
  ...EN_BARISTA,
  ...EN_SERVER_DOWN,
  ...EN_SUSUN_DENAH,
  ...EN_DESAIN_POSTER,
  ...EN_KUIS_PERPUSTAKAAN,
};
