import { Injector, Type } from '@angular/core';
import { createContext, useContext } from 'react';

export const InjectorContext = createContext<Injector | null>(null);

/** Gets the current Angular injector */
export function useInjector(): Injector {
    return useContext(InjectorContext)!;
}
interface ClassOrAbstract<T> extends Function {
    readonly prototype: T;
}
/** Gets an angular service */
export function useService<T>(type: ClassOrAbstract<T>): T {
    return useInjector().get(type);
}
