/** Thin wrapper — site background lives in root layout now. */
export default function MarketingPageShell({ children }) {
  return <div className="overflow-x-clip pb-12 sm:pb-16">{children}</div>;
}
