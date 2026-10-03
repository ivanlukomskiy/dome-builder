// Thin LGPL-3.0-or-later wrapper around libnest2d. See README.md for source/builds.
#include <emscripten/bind.h>
#include <libnest2d/libnest2d.hpp>
#include <cmath>
#include <stdexcept>

using emscripten::val;

val pack(const val& polygons, double width, double height, double spacing, const val& progress) {
    using namespace libnest2d;
    const unsigned count = polygons["length"].as<unsigned>();
    if (!std::isfinite(width) || !std::isfinite(height) || !std::isfinite(spacing)
        || width <= 0 || height <= 0 || spacing < 0 || count == 0)
        throw std::runtime_error("Invalid nesting input");
    std::vector<Item> items;
    items.reserve(count);
    for (unsigned i = 0; i < count; ++i) {
        const auto points = polygons[i];
        PathImpl path;
        for (unsigned j = 0; j < points["length"].as<unsigned>(); ++j)
            path.emplace_back(static_cast<Coord>(points[j][0].as<double>()),
                              static_cast<Coord>(points[j][1].as<double>()));
        if (path.size() < 3) throw std::runtime_error("Invalid nesting polygon");
        path.push_back(path.front()); // libnest2d expects closed clockwise contours.
        items.emplace_back(PolygonImpl(std::move(path)));
    }

    NestConfig<> config;
    config.placer_config.parallel = false; // The entire call runs in our Web Worker.
    config.placer_config.rotations = {0, Pi / 2, Pi, 3 * Pi / 2};
    config.placer_config.alignment = NestConfig<>::Placement::Alignment::BOTTOM_LEFT;
    config.placer_config.starting_point = NestConfig<>::Placement::Alignment::BOTTOM_LEFT;
    config.placer_config.explore_holes = false;
    // libnest2d inflates each part by half the spacing. Expand the bin by the
    // same amount so spacing does not also become an extra sheet margin.
    const Coord halfGap = static_cast<Coord>(std::ceil(spacing / 2));
    const Box bin(Point(-halfGap, -halfGap),
                  Point(static_cast<Coord>(width) + halfGap, static_cast<Coord>(height) + halfGap));
    nest(items, bin, static_cast<Coord>(spacing), config,
         NestControl(ProgressFunction([&](unsigned remaining) { progress(count - remaining, count); })));

    auto result = val::array();
    for (unsigned i = 0; i < count; ++i) {
        if (items[i].binId() < 0)
            throw std::runtime_error("libnest2d could not place part " + std::to_string(i + 1));
        auto placement = val::object();
        placement.set("index", i);
        placement.set("sheet", items[i].binId());
        placement.set("x", static_cast<double>(getX(items[i].translation())));
        placement.set("y", static_cast<double>(getY(items[i].translation())));
        placement.set("angle", static_cast<double>(items[i].rotation()));
        result.set(i, placement);
    }
    return result;
}

EMSCRIPTEN_BINDINGS(dome_nesting) { emscripten::function("pack", &pack); }
