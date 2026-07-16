/**
 * Camada visual dos cosméticos no cliente: mapeia os IDS estáveis do pacote
 * shared para ícones do set Game Icons (react-icons/gi, aderente ao tema de
 * fantasia) e deriva as variáveis CSS de cor (gradiente/brilho) a partir do
 * `accent` + `accentStyle`. O shared é agnóstico de framework e não importa
 * react-icons; este arquivo é a ponte.
 */
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { IconType } from 'react-icons';
import {
  GiBroadDagger, GiCrenelCrown, GiCrossedSwords, GiCrystalBall, GiDragonHead,
  GiEagleEmblem, GiHighShot, GiMoon, GiRobotGolem, GiShield, GiSpikedDragonHead,
  GiWizardFace, GiWolfHead,
} from 'react-icons/gi';
import { accentStyleDef, DEFAULT_AVATAR, DEFAULT_PROFILE_COVER, normalizeIconId } from '@legendsclash/shared';
import { SIGIL_ICONS, TAUNT_ICONS } from './icons';

/** Sigilo de facção / ícone de nota do Arquivo de Aurélia (id → ícone). */
export function Sigil({ id, className }: { id: string; className?: string }) {
  const Icon = SIGIL_ICONS[id];
  return Icon ? <Icon className={className} /> : null;
}

/** Ícone de uma provocação da arena (id de TAUNTS → ícone). */
export function TauntIcon({ id, className }: { id: string; className?: string }) {
  const Icon = TAUNT_ICONS[id];
  return Icon ? <Icon className={className} /> : null;
}

/**
 * Reduz a imagem enviada para um quadrado de `max`px (recorte central) e devolve
 * um data-URL WebP leve — assim a foto sobe pequena e o servidor valida poucos
 * bytes. Roda no cliente (canvas); rejeita arquivos que não sejam imagem.
 */
export function downscaleImage(file: File, max = 256, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Selecione um arquivo de imagem.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = max;
      canvas.height = max;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Falha ao processar a imagem.'));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, max, max);
      resolve(canvas.toDataURL('image/webp', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler essa imagem.'));
    };
    img.src = url;
  });
}

/** ID de ícone → componente SVG. Avatar e comandante compartilham o namespace. */
const ICONS: Record<string, IconType> = {
  shield: GiShield,
  'crossed-swords': GiCrossedSwords,
  wolf: GiWolfHead,
  dragon: GiDragonHead,
  bow: GiHighShot,
  orb: GiCrystalBall,
  eagle: GiEagleEmblem,
  moon: GiMoon,
  'dragon-spirit': GiSpikedDragonHead,
  crown: GiCrenelCrown,
  wizard: GiWizardFace,
  dagger: GiBroadDagger,
  robot: GiRobotGolem,
};

const PORTRAIT_IMAGES: Record<string, string> = {
  shield: '/assets/cards/Escudo de Aco.webp',
  'crossed-swords': '/assets/cards/Abordagem.webp',
  wolf: '/assets/cards/Lobo das Sombras.webp',
  dragon: '/assets/cards/Dragao Cinzento.webp',
  bow: '/assets/cards/Aqueira eifica.webp',
  orb: '/assets/cards/Orbe de Eter.webp',
  eagle: '/assets/cards/Sentinela das Copas.webp',
  moon: '/assets/cards/Pacto Sombrio.webp',
  'dragon-spirit': '/assets/cards/Serpente do Abismo.webp',
  crown: '/assets/cards/Campea Aurora.webp',
  wizard: '/assets/cards/Arquimago da Fenda.webp',
  dagger: '/assets/cards/Duelista Elfica.webp',
  robot: '/assets/cards/Golem de Pedra.webp',
};

const PROFILE_COVER_IMAGES: Record<string, string> = {
  aurelia: '/assets/illustrations/aurelia-panorama.webp',
  archive: '/assets/illustrations/aurelia-archive.webp',
  'aether-arena': '/assets/illustrations/aether-arena.webp',
  champion: '/assets/cards/Campea Aurora.webp',
};

export function iconFor(id: string | undefined | null): IconType {
  return ICONS[normalizeIconId(id)] ?? ICONS[DEFAULT_AVATAR];
}

export function portraitImageFor(id: string | undefined | null): string | undefined {
  return PORTRAIT_IMAGES[normalizeIconId(id)];
}

export function profileCoverImageFor(id: string | undefined | null): string {
  return PROFILE_COVER_IMAGES[id ?? ''] ?? PROFILE_COVER_IMAGES[DEFAULT_PROFILE_COVER];
}

export function profileCoverVars(id: string | undefined | null): CSSProperties {
  return { ['--profile-cover' as string]: `url("${profileCoverImageFor(id)}")` };
}

function pngFallback(src: string): string {
  return src.replace(/\.webp$/i, '.png');
}

/** Ícone-cosmético "cru" (sem medalhão) — herda a cor via `currentColor`. */
export function CosmeticIcon({
  id, size = 24, className, title,
}: { id: string; size?: number | string; className?: string; title?: string }) {
  const Icon = iconFor(id);
  return <Icon size={size} className={className} aria-hidden title={title} />;
}

/** Retrato visual de um cosmético: imagem curada quando existe, ícone como fallback. */
export function CosmeticPortrait({
  id, className = '', alt = '',
}: { id: string; className?: string; alt?: string }) {
  const src = portraitImageFor(id);
  const [imgLoaded, setImgLoaded] = useState(false);
  if (src) {
    return (
      <span className={`lc-cosmetic-wrapper ${imgLoaded ? 'lc-cosmetic-ready' : ''} ${className}`.trim()}>
        <CosmeticIcon id={id} size="100%" className="lc-cosmetic-fallback" />
        <img
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0) setImgLoaded(true);
          }}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="lc-cosmetic-img"
          onLoad={() => setImgLoaded(true)}
          onError={(event) => {
            if (event.currentTarget.dataset.fallback === '1') return;
            event.currentTarget.dataset.fallback = '1';
            event.currentTarget.src = pngFallback(src);
          }}
        />
      </span>
    );
  }
  return <CosmeticIcon id={id} size="100%" className={className} />;
}

/**
 * Deriva as variáveis CSS do realce a partir da cor-base e do estilo escolhido.
 * - sólido: ambas as cores = `accent` (comportamento atual preservado);
 * - gradiente: usa o par do estilo; o brilho escala por `glow`.
 * Aplicada nos invólucros (medalhão, hero-plate, card de perfil) para que ícone,
 * anel, brilho e título fiquem coesos.
 */
export function accentVars(accent: string, accentStyle?: string): CSSProperties {
  const def = accentStyleDef(accentStyle);
  const [c1, c2] = def.gradient ?? [accent, accent];
  const glowPct = Math.round(def.glow * 70);
  return {
    ['--accent' as string]: c1,
    ['--accent-2' as string]: c2,
    ['--accent-grad' as string]: `linear-gradient(135deg, ${c1}, ${c2})`,
    ['--accent-glow' as string]: `color-mix(in srgb, ${c2} ${glowPct}%, transparent)`,
  };
}

/**
 * Avatar compacto para listas/chat/lobby: foto redonda OU ícone, sem anel nem
 * moldura — leve o bastante para repetir em tabelas e linhas de mensagem.
 */
export function InlineAvatar({
  iconId, photo, size = 20, className = '',
}: { iconId: string; photo?: string | null; size?: number; className?: string }) {
  const [photoReady, setPhotoReady] = useState(false);
  return (
    <span className={`lc-inline ${className}`.trim()} style={{ width: size, height: size }}>
      {photo
        ? (
          <span className={`lc-inline-photo-wrap ${photoReady ? 'lc-photo-ready' : ''}`}>
            <CosmeticPortrait id={iconId} className="lc-inline-fallback" />
            <img
              ref={(el) => {
                if (el && el.complete && el.naturalWidth > 0) setPhotoReady(true);
              }}
              src={photo}
              alt=""
              decoding="async"
              className="lc-inline-photo"
              onLoad={() => setPhotoReady(true)}
            />
          </span>
        )
        : <CosmeticPortrait id={iconId} />}
    </span>
  );
}

/**
 * Medalhão de identidade reutilizável: foto recortada OU retrato do cosmético,
 * com anel em gradiente, brilho e moldura decorativa opcional. A arena passa
 * `photo={null}` para preservar o comandante escolhido como retrato.
 */
export function Avatar({
  iconId, photo, frame = 'none', accent, accentStyle, size = 56, fill = false, className = '', alt,
}: {
  iconId: string;
  photo?: string | null;
  frame?: string;
  accent: string;
  accentStyle?: string;
  /** Lado do medalhão (px). Ignorado quando `fill` preenche o contêiner pai. */
  size?: number;
  /** Preenche o contêiner pai (ex.: retrato responsivo da arena) em vez de px. */
  fill?: boolean;
  className?: string;
  alt?: string;
}) {
  const [photoReady, setPhotoReady] = useState(false);
  const style: CSSProperties = {
    ...accentVars(accent, accentStyle),
    ...(fill ? { width: '100%', height: '100%' } : { width: size, height: size }),
  };
  // o ícone é dimensionado por CSS (.lc-avatar-face svg), então funciona igual
  // em medalhão fixo ou preenchendo um retrato responsivo.
  return (
    <span className={`lc-avatar lc-frame--${frame} ${className}`.trim()} style={style}>
      <span className="lc-avatar-ring">
        <span className="lc-avatar-face">
          {photo
            ? (
              <span className={`lc-avatar-photo-wrap ${photoReady ? 'lc-photo-ready' : ''}`}>
                <CosmeticPortrait id={iconId} alt={alt ?? ''} className="lc-avatar-fallback" />
                <img
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth > 0) setPhotoReady(true);
                  }}
                  src={photo}
                  alt={alt ?? ''}
                  decoding="async"
                  className="lc-avatar-photo"
                  onLoad={() => setPhotoReady(true)}
                />
              </span>
            )
            : <CosmeticPortrait id={iconId} alt={alt ?? ''} />}
        </span>
      </span>
    </span>
  );
}
