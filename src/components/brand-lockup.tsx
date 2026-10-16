import Image from "next/image";
import "./brand-lockup.css";

/** Accessible text is provided by the containing link or button. */
export function BrandLogo({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <>
      <Image
        src="/brand/moneynest-mascot.webp"
        alt=""
        aria-hidden="true"
        className="money-nest-brand-mascot"
        width={50}
        height={50}
        loading="eager"
        unoptimized
      />
      {!iconOnly && (
        <span className="money-nest-wordmark" aria-hidden="true">
          <span className="money-nest-wordmark-money">Money</span>
          <span className="money-nest-wordmark-nest">
            NEST
            <svg className="money-nest-bird" viewBox="0 0 33 29" fill="none" aria-hidden="true">
              <path d="M4 15C5 8 13 5 19 9c3 2 5 5 5 9-2 4-6 7-11 7C7 24 4 21 4 15Z" fill="#7BB757"/>
              <path d="M8 16c3-2 7-1 10 1-1 3-3 5-7 5" fill="#377E57"/>
              <path d="m4 14-4 3 5 1" fill="#263139"/>
              <circle cx="10" cy="13" r="1.6" fill="#263139"/>
              <path d="M16 25v4m5-5v5" stroke="#263139" strokeWidth="1.6" strokeLinecap="round"/>
              <path d="m24 5 3-3m0 11 4-1" stroke="#8AAE66" strokeWidth="2.1" strokeLinecap="round"/>
            </svg>
            <svg className="money-nest-underline" viewBox="0 0 104 15" preserveAspectRatio="none" aria-hidden="true">
              <path d="M2 3C30 17 75 17 102 3" stroke="#9A754D" strokeWidth="2.8" fill="none" strokeLinecap="round"/>
              <path d="M19 8C42 17 69 17 87 8" stroke="#B28B60" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
            </svg>
          </span>
        </span>
      )}
    </>
  );
}

export { BrandLogo as BrandLockup };

/** Decorative app artwork; the surrounding surface supplies its accessible name. */
export function AppBrandIcon({ size = 48 }: { size?: number }) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      aria-hidden="true"
      className="money-nest-app-icon"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      loading="eager"
      unoptimized
    />
  );
}

export function NestBotAvatar({ size = 25 }: { size?: number }) {
  return (
    <Image
      src="/brand/nestbot-icon.webp"
      alt=""
      aria-hidden="true"
      className="money-nest-bot-avatar"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      loading="eager"
      unoptimized
    />
  );
}
