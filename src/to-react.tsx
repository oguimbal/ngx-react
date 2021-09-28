import { ApplicationRef, ComponentFactory, ComponentFactoryResolver, ComponentRef, EmbeddedViewRef, Injector, Type } from '@angular/core';
import { createRef, Dispatch, JSXElementConstructor, SetStateAction } from 'react';
import { Component } from 'react';
import { Observable } from 'rxjs';
import { render } from 'react-dom';
import { ToAngularBridge } from './to-angular';
import { InjectorContext } from './services';

interface ToReactOpts {
    /** Has transcluded children ? */
    children?: true;
}

/**
 * A handler that will be called when the component is created.
 *
 * If you want to subscribe to subsequent renders, return a handler,
 * that will be called on each react re-render with the current directive value.
 */
export type NgxReactBridgeDirective<ValueType> = (
    value: ValueType,
    angularComponent: ComponentRef<any>,
    domElement: HTMLElement
) => any | OnDirectiveRender<ValueType>;

export type OnDirectiveRender<T> = (value: T) => void;

export class NgxReactBridge<directives = {}> extends ToAngularBridge {

    private directives: [string, NgxReactBridgeDirective<any>][] = [];

    /**
     * Declares an equivalent of an angular directive: A prop that will appear on all React registered component.
     *
     * Usage ex:
     *   .addDirective('focus', (focus, _, elt) => setTimeout(() => focus && elt.focus()))
     */
    addDirective<dirValueType, dirName extends string>(name: dirName,
        attach: NgxReactBridgeDirective<dirValueType>)
        : NgxReactBridge<directives & { [key in dirName]?: dirValueType }> {
        this.directives.push([name, attach]);
        return this as any;
    }

    /** Registers an angular component, and returns its React equivalent */
    toReact<T, O extends ToReactOpts>(ctor: Type<T>, opts?: O): AngularToReact<T, O, directives> {
        const that = this;
        interface IO {
            prop: string;
            evt: string;
            state: string;
        }
        interface InjectorCache {
            componentFactory: ComponentFactory<any>;
            injector: Injector;
            appRef: ApplicationRef;
            inOuts: IO[];
            inOutsByEvent: Map<string, IO>;
            inOutsByProp: Map<string, IO>;
        }


        // cache things in a weakmap (tiny perf gain)
        const injectors = new WeakMap<Injector, InjectorCache>();
        function cacheFactory(injector: Injector): InjectorCache {
            let ret = injectors.get(injector);
            if (ret) {
                return ret;
            }

            const appRef = injector.get(ApplicationRef);
            const componentFactoryResolver = injector.get(ComponentFactoryResolver);
            const componentFactory = componentFactoryResolver
                .resolveComponentFactory(ctor);

            const outs = new Set(componentFactory.outputs.map(x => x.propName));
            // infer properties that are acting as two-ways bindindabe states
            //  (i.e.  somevalue input + somevalueChange output)
            const inOuts = componentFactory
                .inputs
                .filter(x => outs.has(x.propName + 'Change'))
                .map<IO>(x => ({
                    prop: x.propName,
                    evt: x.propName + 'Change',
                    state: `${x.propName}$`,
                }));
            const inOutsByEvent = new Map(inOuts.map(x => [x.evt, x]));
            const inOutsByProp = new Map(inOuts.map(x => [x.prop, x]));

            // cache & return result
            ret = { injector, inOuts, inOutsByEvent, inOutsByProp, appRef, componentFactory };
            injectors.set(injector, ret);
            return ret;
        }
        return class extends Component<any> {
            static contextType = InjectorContext;
            private componentRef?: ComponentRef<any>;
            private domRef = createRef<HTMLSpanElement>();
            private updateTick?: number;
            private readonly childNode = document.createElement('span');
            private childrenRender?: number;
            private directiveSubs: [string, OnDirectiveRender<any>][] = [];
            private factory!: InjectorCache;

            componentDidMount() {
                // find factory
                const { injector, inOutsByEvent, componentFactory, appRef } = this.factory = cacheFactory(this.context);

                // Create a component reference from the component
                this.componentRef = componentFactory
                    .create(injector, [[this.childNode]]);

                // Subscribe to events & forward them to react props as functions
                for (const { propName } of componentFactory.outputs) {
                    (this.componentRef.instance[propName] as Observable<any>)
                        .subscribe(e => {
                            // forward to listener
                            this.props[propName]?.(e);

                            // forward to state setters
                            const stateProp = inOutsByEvent.get(propName);
                            if (stateProp) {
                                const val = this.props[stateProp.state] as ReactState<any>;
                                val?.[1](e);
                            }
                        })
                }

                // Attach component to the appRef so that it's inside the ng component tree
                appRef.attachView(this.componentRef.hostView);

                // Get DOM element from component
                const domElem = (this.componentRef.hostView as EmbeddedViewRef<any>)
                    .rootNodes[0] as HTMLElement;

                // 4. Append DOM element to the body
                this.domRef.current!.appendChild(domElem);


                // attach directives
                for (const [nm, attach] of that.directives) {
                    if (nm in this.props) {
                        const sub = attach(this.props[nm], this.componentRef, domElem);

                        // subscribed
                        if (typeof sub === 'function') {
                            this.directiveSubs.push([nm, sub]);
                        }
                    }
                }

                // update properties
                this.updatePropsNow();
            }

            componentWillUnmount() {
                if (this.componentRef) {
                    this.factory!.appRef.detachView(this.componentRef.hostView);
                    this.componentRef.destroy();
                    this.componentRef = undefined;
                }
            }

            render() {
                this.updateProps();

                clearTimeout(this.childrenRender);
                if (this.props.children) {
                    this.childrenRender = setTimeout(() => render(<>{this.props.children}</>, this.childNode));
                } else if (this.childNode.firstChild) {
                    this.childrenRender = setTimeout(() => this.childNode.innerHTML = '');
                }

                return <span className={this.props.className} ref={this.domRef} />;
            }

            private updateProps() {
                if (!this.componentRef) {
                    return;
                }
                clearTimeout(this.updateTick);
                this.updateTick = setTimeout(() => {
                    this.updatePropsNow();
                    this.updateDirectives();
                })
            }

            private updateDirectives() {
                for (const [n, fn] of this.directiveSubs) {
                    fn(this.props[n]);
                }
            }

            private updatePropsNow() {
                if (!this.componentRef) {
                    return;
                }

                const { componentFactory, inOutsByProp, inOuts } = this.factory;

                // forward input props
                for (const { propName } of componentFactory.inputs) {
                    // if the two-way property is bound to a react state,
                    // then do not forward property values
                    const asInOut = inOutsByProp.get(propName);
                    if (asInOut && this.props[asInOut.state]) {
                        continue;
                    }

                    // if property has changed, then set it
                    if (propName in this.props) {
                        const propVal = this.props[propName];
                        if (propVal !== this.componentRef.instance[propName]) {
                            this.componentRef.instance[propName] = propVal;
                        }
                    }
                }

                // forward states
                for (const { prop, state } of inOuts) {
                    const boundState = this.props[state] as ReactState<any>;
                    if (boundState && Array.isArray(boundState)) {
                        this.componentRef.instance[prop] = boundState[0];
                    }
                }


                // force change detection
                this.componentRef.changeDetectorRef.detectChanges();
            }
        }
    }
}



type AngularToReact<T, O, directives>
    = JSXElementConstructor<
        DetectOutputs<T>
        & DeconstructOpts<O>
        & directives
        & { className?: string; }
    >;


type Elt = string | JSX.Element;
type DeconstructOpts<O>
    = (O extends { children: true } ? { children?: Elt | Elt[] } : {});

/**
 * Detects two-way bindindable props
 *
 * ex:
 * ```typescript
        type XX = { a: string, b: number, bChange: Observable<number> };
        type OUTPUTS = DetectOutputs<XX> //  => Record<"a", string> & Record<"b", number> & Record<"b$", ReactState<number>> & Record<"bChange", Observable<number>>;
    ```
 */

type DetectOutputs<T> = Optional<UnionToIntersection<ToObj<Ouptuts<T, keyof T>>>>;
type ReactState<S> = [S, Dispatch<SetStateAction<S>>];

type Optional<X> = { [k in keyof X]?: X[k] };

type Ouptuts<O, K extends keyof O> = K extends `${infer X}Change`
    ? X extends (keyof O)
    ? EmitterType<O, X, K> | [K, PropType<O[K]>] : [K, PropType<O[K]>] : [K, PropType<O[K]>];

type PropType<T> = T extends Observable<infer E> ? (event: E) => any : T;

/** Builds an emitter type from matching input + output properties */
type EmitterType<O, V extends keyof O & string, E extends keyof O>
    = O[E] extends Observable<infer T>
    ? O[V] extends T ? [`${V}$`, ReactState<T>]
    : never : never;


type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type ToObj<A> = A extends [infer K, infer V]
    ? K extends string ? Record<K, PropType<V>>
    : never : never;
