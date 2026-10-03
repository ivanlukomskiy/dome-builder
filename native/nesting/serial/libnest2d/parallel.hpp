// LGPL-3.0-or-later. Browser adaptation of libnest2d's parallel.hpp interface.
// The upstream NFP calculation requests std::async even when config.parallel
// is false. Use a serial executor in our dedicated worker: no pthreads or
// cross-origin-isolation headers are required by the static site.
#ifndef LIBNEST2D_PARALLEL_HPP
#define LIBNEST2D_PARALLEL_HPP
#include <functional>
#include <future>
#include <iterator>

namespace libnest2d { namespace __parallel {
template<class It>
using TIteratorValue = typename std::iterator_traits<It>::value_type;

template<class Iterator>
inline void enumerate(Iterator from, Iterator to,
                      std::function<void(TIteratorValue<Iterator>, size_t)> fn,
                      std::launch = std::launch::deferred) {
    size_t index = 0;
    for (; from != to; ++from, ++index) fn(*from, index);
}
}}
#endif
