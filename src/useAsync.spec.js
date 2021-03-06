import "jest-dom/extend-expect"
import React from "react"
import { render, fireEvent, cleanup, waitForElement, flushEffects } from "react-testing-library"
import { useAsync } from "."

const abortCtrl = { abort: jest.fn() }
window.AbortController = jest.fn().mockImplementation(() => abortCtrl)

beforeEach(abortCtrl.abort.mockClear)
afterEach(cleanup)

const resolveIn = ms => value => new Promise(resolve => setTimeout(resolve, ms, value))
const resolveTo = resolveIn(0)

const Async = ({ children = () => null, ...props }) => children(useAsync(props))

describe("useAsync", () => {
  test("returns render props", async () => {
    const promiseFn = () => new Promise(resolve => setTimeout(resolve, 0, "done"))
    const component = <Async promiseFn={promiseFn}>{({ data }) => data || null}</Async>
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("done"))
  })

  test("passes rejection error to children as render prop", async () => {
    const promiseFn = () => Promise.reject("oops")
    const component = <Async promiseFn={promiseFn}>{({ error }) => error || null}</Async>
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("oops"))
  })

  test("passes isLoading boolean while the promise is running", async () => {
    const promiseFn = () => resolveTo("done")
    const states = []
    const component = (
      <Async promiseFn={promiseFn}>
        {({ data, isLoading }) => {
          states.push(isLoading)
          return data || null
        }}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("done"))
    expect(states).toEqual([true, true, false])
  })

  test("passes startedAt date when the promise starts", async () => {
    const promiseFn = () => resolveTo("done")
    const component = (
      <Async promiseFn={promiseFn}>
        {({ startedAt }) => {
          if (startedAt) {
            expect(startedAt.getTime()).toBeCloseTo(new Date().getTime(), -2)
            return "started"
          }
          return null
        }}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("started"))
  })

  test("passes finishedAt date when the promise finishes", async () => {
    const promiseFn = () => resolveTo("done")
    const component = (
      <Async promiseFn={promiseFn}>
        {({ data, finishedAt }) => {
          if (finishedAt) {
            expect(finishedAt.getTime()).toBeCloseTo(new Date().getTime(), -1)
            return data || null
          }
          return null
        }}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("done"))
  })

  test("passes reload function that re-runs the promise", async () => {
    const promiseFn = jest.fn().mockReturnValue(resolveTo("done"))
    const component = (
      <Async promiseFn={promiseFn}>
        {({ reload }) => <button onClick={reload}>reload</button>}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    expect(promiseFn).toHaveBeenCalledTimes(1)
    fireEvent.click(getByText("reload"))
    expect(promiseFn).toHaveBeenCalledTimes(2)
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
  })

  test("re-runs the promise when the value of 'watch' changes", () => {
    class Counter extends React.Component {
      state = { count: 0 }
      inc = () => this.setState(state => ({ count: state.count + 1 }))
      render() {
        return (
          <div>
            <button onClick={this.inc}>increment</button>
            {this.props.children(this.state.count)}
          </div>
        )
      }
    }
    const promiseFn = jest.fn().mockReturnValue(resolveTo())
    const component = <Counter>{count => <Async promiseFn={promiseFn} watch={count} />}</Counter>
    const { getByText } = render(component)
    flushEffects()
    expect(promiseFn).toHaveBeenCalledTimes(1)
    fireEvent.click(getByText("increment"))
    flushEffects()
    expect(promiseFn).toHaveBeenCalledTimes(2)
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
    fireEvent.click(getByText("increment"))
    flushEffects()
    expect(promiseFn).toHaveBeenCalledTimes(3)
    expect(abortCtrl.abort).toHaveBeenCalledTimes(2)
  })

  test("runs deferFn only when explicitly invoked, passing arguments and props", () => {
    let counter = 1
    const deferFn = jest.fn().mockReturnValue(resolveTo())
    const component = (
      <Async deferFn={deferFn} foo="bar">
        {({ run }) => {
          return <button onClick={() => run("go", counter++)}>run</button>
        }}
      </Async>
    )
    const { getByText } = render(component)
    const props = { deferFn, foo: "bar" }
    flushEffects()
    expect(deferFn).not.toHaveBeenCalled()
    fireEvent.click(getByText("run"))
    expect(deferFn).toHaveBeenCalledWith("go", 1, expect.objectContaining(props), abortCtrl)
    fireEvent.click(getByText("run"))
    expect(deferFn).toHaveBeenCalledWith("go", 2, expect.objectContaining(props), abortCtrl)
  })

  test("cancel will prevent the resolved promise from propagating and attempts to abort it", async () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.resolve("ok"))
    const onResolve = jest.fn()
    const component = (
      <Async promiseFn={promiseFn} onResolve={onResolve}>
        {({ cancel }) => <button onClick={cancel}>cancel</button>}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    fireEvent.click(getByText("cancel"))
    await Promise.resolve()
    expect(onResolve).not.toHaveBeenCalled()
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
  })

  test("reload uses the arguments of the previous run", () => {
    let counter = 1
    const deferFn = jest.fn().mockReturnValue(resolveTo())
    const component = (
      <Async deferFn={deferFn}>
        {({ run, reload }) => {
          return (
            <div>
              <button onClick={() => run("go", counter++)}>run</button>
              <button onClick={reload}>reload</button>
            </div>
          )
        }}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    expect(deferFn).not.toHaveBeenCalled()
    fireEvent.click(getByText("run"))
    expect(deferFn).toHaveBeenCalledWith("go", 1, expect.objectContaining({ deferFn }), abortCtrl)
    fireEvent.click(getByText("run"))
    expect(deferFn).toHaveBeenCalledWith("go", 2, expect.objectContaining({ deferFn }), abortCtrl)
    fireEvent.click(getByText("reload"))
    expect(deferFn).toHaveBeenCalledWith("go", 2, expect.objectContaining({ deferFn }), abortCtrl)
  })

  test("only accepts the last invocation of the promise", async () => {
    let i = 0
    const resolves = [resolveIn(10)("a"), resolveIn(20)("b"), resolveIn(10)("c")]
    const component = (
      <Async deferFn={i => resolves[i]}>
        {({ data, run }) => {
          if (data) {
            expect(data).toBe("c")
            return "done"
          }
          return <button onClick={() => run(i)}>run</button>
        }}
      </Async>
    )
    const { getByText } = render(component)
    fireEvent.click(getByText("run"))
    i++
    fireEvent.click(getByText("run"))
    i++
    fireEvent.click(getByText("run"))
    await waitForElement(() => getByText("done"))
  })

  test("invokes onResolve callback when promise resolves", async () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.resolve("ok"))
    const onResolve = jest.fn()
    const component = <Async promiseFn={promiseFn} onResolve={onResolve} />
    render(component)
    flushEffects()
    await Promise.resolve()
    expect(onResolve).toHaveBeenCalledWith("ok")
  })

  test("invokes onReject callback when promise rejects", async () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.reject("err"))
    const onReject = jest.fn()
    const component = <Async promiseFn={promiseFn} onReject={onReject} />
    render(component)
    flushEffects()
    await Promise.resolve()
    expect(onReject).toHaveBeenCalledWith("err")
  })

  test("cancels pending promise when unmounted", async () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.resolve("ok"))
    const onResolve = jest.fn()
    const component = <Async promiseFn={promiseFn} onResolve={onResolve} />
    const { unmount } = render(component)
    flushEffects()
    unmount()
    await Promise.resolve()
    expect(onResolve).not.toHaveBeenCalled()
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
  })

  test("cancels and restarts the promise when promiseFn changes", async () => {
    const promiseFn1 = jest.fn().mockReturnValue(Promise.resolve("one"))
    const promiseFn2 = jest.fn().mockReturnValue(Promise.resolve("two"))
    const onResolve = jest.fn()
    const component1 = <Async promiseFn={promiseFn1} onResolve={onResolve} />
    const component2 = <Async promiseFn={promiseFn2} onResolve={onResolve} />
    const { rerender } = render(component1)
    await Promise.resolve()
    flushEffects()
    expect(promiseFn1).toHaveBeenCalled()
    rerender(component2)
    flushEffects()
    expect(promiseFn2).toHaveBeenCalled()
    expect(onResolve).not.toHaveBeenCalledWith("one")
    await Promise.resolve()
    expect(onResolve).toHaveBeenCalledWith("two")
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
  })

  test("cancels the promise when promiseFn is unset", async () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.resolve("one"))
    const onResolve = jest.fn()
    const component1 = <Async promiseFn={promiseFn} onResolve={onResolve} />
    const component2 = <Async onResolve={onResolve} />
    const { rerender } = render(component1)
    await Promise.resolve()
    flushEffects()
    expect(promiseFn).toHaveBeenCalled()
    rerender(component2)
    flushEffects()
    expect(onResolve).not.toHaveBeenCalledWith("one")
    await Promise.resolve()
    expect(abortCtrl.abort).toHaveBeenCalledTimes(1)
  })

  test("does not run promiseFn on mount when initialValue is provided", () => {
    const promiseFn = jest.fn().mockReturnValue(Promise.resolve())
    const component = <Async promiseFn={promiseFn} initialValue={{}} />
    render(component)
    flushEffects()
    expect(promiseFn).not.toHaveBeenCalled()
  })

  test("does not start loading when using initialValue", async () => {
    const promiseFn = () => resolveTo("done")
    const states = []
    const component = (
      <Async promiseFn={promiseFn} initialValue="done">
        {({ data, isLoading }) => {
          states.push(isLoading)
          return data
        }}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("done"))
    expect(states).toEqual([false])
  })

  test("passes initialValue to children immediately", async () => {
    const promiseFn = () => resolveTo("done")
    const component = (
      <Async promiseFn={promiseFn} initialValue="done">
        {({ data }) => data}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("done"))
  })

  test("sets error instead of data when initialValue is an Error object", async () => {
    const promiseFn = () => resolveTo("done")
    const error = new Error("oops")
    const component = (
      <Async promiseFn={promiseFn} initialValue={error}>
        {({ error }) => error.message}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("oops"))
  })

  test("can be nested", async () => {
    const outerFn = () => resolveIn(0)("outer")
    const innerFn = () => resolveIn(100)("inner")
    const component = (
      <Async promiseFn={outerFn}>
        {({ data: outer }) => (
          <Async promiseFn={innerFn}>
            {({ data: inner }) => {
              return outer + " " + inner
            }}
          </Async>
        )}
      </Async>
    )
    const { getByText } = render(component)
    flushEffects()
    await waitForElement(() => getByText("outer undefined"))
    await waitForElement(() => getByText("outer inner"))
  })
})
