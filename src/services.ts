import { Injector, Type } from '@angular/core';
import { createContext, useContext } from 'react';

export const InjectorContext = createContext<Injector | null>(null);

/** Gets the current Angular injector */
export function useInjector(): Injector {
    return useContext(InjectorContext)!;
}

/** Gets an angular service */
export function useService<T>(type: Type<T>): T {
    return useInjector().get(type);
}
