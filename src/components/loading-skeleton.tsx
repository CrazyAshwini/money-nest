import styles from "./loading-skeleton.module.css";

/** Empty surfaces indicate a pending request without inventing financial values. */
export function LoadingSkeleton({
  variant = "rows",
}: {
  variant?: "rows" | "totals";
}) {
  return (
    <div
      className={variant === "totals" ? styles.totals : styles.rows}
      aria-hidden="true"
    >
      {Array.from({ length: variant === "totals" ? 4 : 3 }, (_, index) => (
        <div className={styles.item} key={index}>
          <span className={styles.label} />
          <span className={styles.value} />
          {variant === "rows" && <span className={styles.detail} />}
        </div>
      ))}
    </div>
  );
}
