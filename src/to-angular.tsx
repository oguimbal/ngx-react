import { Directive, EventEmitter, Injector, OnChanges, OnDestroy, OnInit, SimpleChanges, Type, ViewContainerRef } from '@angular/core';
import { render, unmountComponentAtNode } from 'react-dom';
import { JSXElementConstructor } from 'react';
import { Observable } from 'rxjs';
import { InjectorContext } from './services';


export type ReactWrapper = React.JSXElementConstructor<{ children: any; injector: Injector }>;

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
     *
     */
    toAngular<T>(Ctor: JSXElementConstructor<T>, Wrapper?: ReactWrapper): ToAngular<T> {
        const that = this;
        @Directive({ selector: '__ignore__' })
        class DirBase implements OnInit, OnChanges, OnDestroy {
            private props: any = {};
            constructor(private vr: ViewContainerRef, private injector: Injector) {
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
                let Elt = () => <Ctor {...this.props} />;

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
                render(<InjectorContext.Provider value={this.injector}>
                    <Elt />
                </InjectorContext.Provider>, this.vr.element.nativeElement);
            }

            ngOnDestroy() {
                unmountComponentAtNode(this.vr.element.nativeElement)
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



type ToAngular<T> = Type<MapNg<T>>;
type MapNg<T> = { [k in keyof T]: PropType<T[k]> }
type PropType<T> = T extends (arg: infer X) => any ? Observable<X> : T;
