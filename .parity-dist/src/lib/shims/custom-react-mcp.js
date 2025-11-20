import * as React from 'react';
export function customMcpProvider({ children }) {
    if (process.env.NODE_ENV === 'development')
        console.log('[custom shim] customMcpProvider (noop)');
    return <>{children}</>;
}
//# sourceMappingURL=custom-react-mcp.js.map