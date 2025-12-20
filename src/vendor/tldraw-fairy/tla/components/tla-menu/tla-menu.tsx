import React, { createContext, useContext } from 'react';

const TabsContext = createContext<{
  activeTab: string;
  onTabChange: (tab: string) => void;
} | null>(null);

export function TlaMenuTabsRoot({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ activeTab, onTabChange }}>
      <div className="tla-menu-tabs-root">{children}</div>
    </TabsContext.Provider>
  );
}

export function TlaMenuTabsTabs({ children }: { children: React.ReactNode }) {
  return <div className="tla-menu-tabs">{children}</div>;
}

export function TlaMenuTabsTab({ id, children }: { id: string; children: React.ReactNode }) {
  const ctx = useContext(TabsContext);
  const isActive = ctx?.activeTab === id;
  return (
    <button
      type="button"
      className={`tla-menu-tab${isActive ? ' is-active' : ''}`}
      onClick={() => ctx?.onTabChange(id)}
    >
      {children}
    </button>
  );
}
