var EasyPromise = (function () {
  // resolve 和 reject 都是异步的
  // 因为 executor 中就算执调用行了resolve
  // 仍然要执行完executor之后的代码
  // 这点和throw 的机制不同

  function reject (reason) {
    // reject 和resolve 不同，
    // 直接原样将值抛出
    setTimeout(() => {
      if (this.status !== 'pending') return
      this.status = 'rejected'
      this.data = reason
      for (let each of this.onRejectedCallback) {
        each(reason)
      }
    }, 0)
  }

  function resolve (value) {
    // 如果resolve 返回的是then刚返回的promise，直接报错
    // 因为这相当于promise返回了自己, 由于promise会一直解
    // 析直至非promise， 这将导致无限循环, 具体情况可以看测试代码
    if (this === value) {
      return reject.bind(this)(new TypeError('Chaining cycle detected for promise!'))
    }

    // 以下代码就是尝试展开一个promise
    // 如果value是promise，或者是类promise i.e thenable
    // 我们就尝试将它作为promise进行使用
    // 这样做的原因是保证ES6之前的promise polyfill
    // 也能和ES6的原生promise混用
    // 但是实际上value.then 是什么我们并不清楚
    // 所以当then同时调用了 res, rej 的情况下
    // 我们以第一次调用的结果为准， 这也是为什么当
    // thenAlreadyCalledOrThrow 为true 时我们直接返回
    let thenAlreadyCalledOrThrow = false
    if ((value !== null) &&
      ((typeof value === 'object') || (typeof value === 'function'))) {
      try {
        let then = value.then
        if (typeof then === 'function') {
          // 一个非空的对象， 假设它是thenable来保证promise的兼容性
          // 如果有then，直接把他当成promise来使用
          then.call(value, y => {
            if (thenAlreadyCalledOrThrow) return
            thenAlreadyCalledOrThrow = true
            resolve.bind(this)(y)
          }, r => {
            if (thenAlreadyCalledOrThrow) return
            thenAlreadyCalledOrThrow = true
            reject.bind(this)(r)
          })
        } else {
          // x对象没有then，说明不是，相当于then里面返回了一个
          // 正常的值， 所以直接异步回调即可
          setTimeout(() => {
            if (this.status !== 'pending') return
            this.status = 'resolved'
            this.data = value
            for (let each of this.onResolvedCallback) {
              each(value)
            }
          }, 0)
        }
      } catch (e) {
        if (thenAlreadyCalledOrThrow) return
        thenAlreadyCalledOrThrow = true
        reject.bind(this)(e)
      }
    } else {
      setTimeout(() => {
        if (this.status !== 'pending') return
        this.status = 'resolved'
        this.data = value
        for (let each of this.onResolvedCallback) {
          each(value)
        }
      }, 0)
    }
  }

  function Promise (executor) {
    if (typeof executor !== 'function') {
    // 非标准 但与Chrome谷歌保持一致
      throw new TypeError('Promise resolver ' + executor + ' is not a function')
    }

    this.status = 'pending'
    this.data = undefined
    this.onResolvedCallback = []
    this.onRejectedCallback = []

    // 实现过程中如果出现 Error, 直接reject.
    try {
      executor(resolve.bind(this), reject.bind(this))
    } catch (e) {
      reject.bind(this)(e)
    }
  }

  Promise.prototype.then = function (onfulfilled, onrejected) {
    // 返回值穿透
    if (typeof onfulfilled !== 'function') onfulfilled = data => data
    // 错误穿透， 注意这里要用throw而不是return， 因为如果是return的话
    // 那么这个then返回的promise状态将变成resolved但是我们想要的是rejected
    // 这样才能调用之后的onrejected
    if (typeof onrejected !== 'function') onrejected = reason => { throw reason }

    let thenPromise
    if (this.status === 'resolved') {
      thenPromise = new Promise((resolve, reject) => {
        // 使用箭头函数来保证this一直指向原Promise对象
        // 源代码中使用了this
        // then函数返回时promise是同步的， 但执行then回调必须是异步的
        setTimeout(() => {
          try {
            // 这个onfulfilled 就是then的回调函数
            // 无论什么时候他必须异步
            // 当前this.status 是 resolved (rejeted 也一样)
            // 说明此时的event loop已经不是promise状态改变的
            // 那个event loop了，所以此时要想 then代码异步,
            // 必须加上setTimeout
            // 而下面  this.state 是 ‘pending’ 则不同
            // 因为起码在该次event loop之内，promise的状态不会
            // 改变，所以已经确保了这个then起码会在下一个
            // event loop 才被调用， 也就是已经确保了异步
            var x = onfulfilled(this.data)
            // 这里的then 已经被绑定在了 thenPromise 上
            // 所以不需要 bind
            resolve(x)
          } catch (e) {
            reject(e)
          }
        })
      })
    }
    if (this.status === 'rejected') {
      thenPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            var x = onrejected(this.data)
            resolve(x)
          } catch (e) {
            reject(e)
          }
        })
      })
    }
    if (this.status === 'pending') {
      // 这里之所以没有异步执行，是因为这些函数必然会被resolve或reject调用，而resolve或reject函数里的内容已是异步执行，构造函数里的定义
      // 以上是原解释， 其实是不完整的, 只是解释了为什么没必要添加setTimerout
      // 但是并没有解释为什么添加之后是错的 (不信的可以拿源代码添加之后跑测试)
      // 原因在于， 如果源代码在下一个event loop 完成了， 那么他会立即调用回调，
      // 但是此时回调还没有被push到新的promise上
      thenPromise = new Promise((resolve, reject) => {
        this.onResolvedCallback.push(() => {
          try {
            var x = onfulfilled(this.data)
            resolve(x)
          } catch (e) {
            reject(e)
          }
        })

        this.onRejectedCallback.push(() => {
          try {
            var x = onrejected(this.data)
            resolve(x)
          } catch (e) {
            reject(e)
          }
        })
      })
    }
    return thenPromise
  }

  // for prmise A+ test
  Promise.deferred = Promise.defer = function () {
    var dfd = {}
    dfd.promise = new Promise(function (resolve, reject) {
      dfd.resolve = resolve
      dfd.reject = reject
    })
    return dfd
  }

  // for nodejs
  if (typeof module !== 'undefined') {
    module.exports = Promise
  }

  return Promise
})() // IIFE for old browser

// ES6
// export default EasyPromise

EasyPromise.all = function (promises) {
  return new Promise((resolve, reject) => {
    const result = []
    let cnt = 0
    for (let i = 0; i < promises.length; ++i) {
      promises[i].then(value => {
        cnt++
        result[i] = value
        if (cnt === promises.length) resolve(result)
      }, reject)
    }
  })
}

EasyPromise.race = function (promises) {
  return new Promise((resolve, reject) => {
    for (let i = 0; i < promises.length; ++i) {
      promises[i].then(resolve, reject)
    }
  })
}
