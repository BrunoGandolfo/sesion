interface EditorialRuleProps {
  className?: string;
}

export function EditorialRule({ className = "" }: EditorialRuleProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block align-middle mr-3 bg-sage-500 ${className}`}
      style={{ width: 24, height: 1.5 }}
    />
  );
}
