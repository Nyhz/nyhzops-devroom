interface PageHeaderProps {
  codename: string;
  section: string;
  title: string;
  children?: React.ReactNode;
}

export function PageHeader({ codename, section, title, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-dr-dim font-tactical text-xs tracking-wider uppercase mb-1">
          {codename} // {section}
        </div>
        <h1 className="text-dr-amber font-tactical text-lg tracking-wider uppercase">
          {title}
        </h1>
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}
