import { ContentChild, Directive, EmbeddedViewRef, EventEmitter, Injector, OnChanges, OnDestroy, OnInit, SimpleChanges, TemplateRef, Type, ViewChild, ViewContainerRef } from '@angular/core';
import { createRoot, Root } from 'react-dom/client';
import { createElement, JSXElementConstructor, useEffect, useRef, useState } from 'react';
import { Observable } from 'rxjs';
import { InjectorContext } from './services';


export type ReactWrapper = React.JSXElementConstructor<{ children: any; injector: Injector }>;
export const HAS_CHILDREN_TEMPLATE = `<ng-template #content><span><ng-content></ng-content></span></ng-template>`;
export class ToAngularBridge {

    private providers: ReactWrapper[] = [];

    /**
     *
     * Converts a React component to an Angular component.
     * A bit of extra work will be required, though. Usage:
     *
     * ```typescript
@Directive({ selector: 'my-react-component' })
export class MyReactComponent_Angular extends reactBridge.toAngular(MyReactComponent) {

    // 👉 declare the inputs/outputs that corresponds to your react props (types must be compatible)

    // ... for a prop "data: string"
    @Input()
    data!: string;

    // ... for a prop "dataChange: (e: string) => any"
    @Output()
    dataChange = new EventEmitter();
}
```

    if your react component has a `children` prop, you can use it like this:
```typescript
    @Component({
        selector: 'my-react-component',
        template: HAS_CHILDREN_TEMPLATE
    })
    export class MyReactComponent_Angular extends reactBridge.toAngular(MyReactComponent) {
        ...
    }
```
     *
     */
    toAngular<T>(Ctor: JSXElementConstructor<T>, Wrapper?: ReactWrapper): ToAngular<T> {
        const that = this;
        @Directive({ selector: '__ignore__' })
        class DirBase implements OnInit, OnChanges, OnDestroy {
            private props: any = {};
            private root: Root | null = null;
            private setProps?: (props: any) => void;

            @ContentChild(TemplateRef)
            _contentRef?: TemplateRef<any>;
            _contentView?: EmbeddedViewRef<unknown>;

            constructor(private vr: ViewContainerRef
                , private injector: Injector) {
                // this.refresh(); triggers creation twice once ngOnInit() re-refreshes (and thus potential duplicated actions & unmounted component warnings)
                // for instance, this component:  function MyComponent() { const [v, sv] = useState(false);  useEffect(() => {setTimeout(() => sv(true), 50)}); return <div></div> }
                // will trigger such warning once setTimeout() calls its callback.
            }

            ngOnInit() {
                for (const [k, v] of Object.entries(this)) {
                    if (!(v instanceof EventEmitter)) {
                        continue;
                    }
                    this.props[k] = (e: any) => v.emit(e);
                }
                this.refresh();
            }

            ngAfterViewInit() {
                this.refresh();
            }

            ngOnChanges(ch: SimpleChanges) {
                this.props = {
                    ...this.props,
                }
                for (const [k, { currentValue }] of Object.entries(ch)) {
                    this.props[k] = currentValue;
                }
                this.refresh();
            }

            private refresh() {
                if (this._contentRef) {
                    this._contentView ??= this.vr.createEmbeddedView(this._contentRef);
                    this._contentView.detectChanges();
                    this.props.children ??= createElement(NgContent, {
                        children: this._contentView.rootNodes,
                    });
                }

                if (!this.root) {
                    this.root = createRoot(this.vr.element.nativeElement);

                    let Elt = () => {
                        const [props, setProps] = useState(this.props);
                        this.setProps = setProps;
                        return <Ctor {...props} />
                    };

                    // apply global wrappers
                    for (const Wrap of that.providers) {
                        const OldEl = Elt;
                        Elt = () => (<Wrap injector={this.injector}>
                            <OldEl />
                        </Wrap>);
                    }

                    // apply local wrapper
                    if (Wrapper) {
                        Elt = () => (
                            <Wrapper injector={this.injector}>
                                <Elt />
                            </Wrapper>
                        );
                    }

                    // provide injector & render
                    this.root.render(<InjectorContext.Provider value={this.injector}>
                        <Elt />
                    </InjectorContext.Provider>,);
                } else {
                    this.setProps?.({ ...this.props });
                }
            }

            ngOnDestroy() {
                setTimeout(() => {
                    this.root?.unmount();
                });
            }
        }

        return DirBase as any;
    }


    /**
     * Add a wrapper for each react component root.
     * Use this to declare providers.
     */
    addProvider(render: ReactWrapper): this {
        this.providers.push(render);
        return this;
    }
}

function NgContent({ children }: { children: HTMLElement[] }) {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!ref.current) {
            return;
        }
        for (const c of children) {
            ref.current.appendChild(c);
        }
    }, [children]);
    return <span ref={ref}></span>;
}

type ToAngular<T> = Type<MapNg<T>>;
type MapNg<T> = { [k in keyof T]: PropType<T[k]> } & { ngOnInit(): void; ngOnChanges(changes: SimpleChanges): void };
type PropType<T> = T extends (arg: infer X) => any ? Observable<X> : T;
