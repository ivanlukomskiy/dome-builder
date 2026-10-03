cmake_minimum_required(VERSION 3.20)
project(dome_nesting LANGUAGES C CXX)

# All dependencies are pinned by build.sh. Build only NLopt and Clipper; libnest2d
# and Boost are header-only. No toolchain is needed for ordinary npm builds.
set(CMAKE_CXX_STANDARD 14)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
foreach(option NLOPT_PYTHON NLOPT_OCTAVE NLOPT_MATLAB NLOPT_GUILE NLOPT_SWIG NLOPT_TESTS)
  set(${option} OFF CACHE BOOL "" FORCE)
endforeach()
add_subdirectory(${NLOPT_SOURCE} ${CMAKE_BINARY_DIR}/nlopt)
add_executable(nesting nesting.cpp ${CLIPPER_SOURCE}/clipper.cpp)
target_include_directories(nesting PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/serial ${LIBNEST2D_SOURCE}/include ${CLIPPER_SOURCE} ${BOOST_SOURCE})
target_link_libraries(nesting PRIVATE nlopt)
target_compile_definitions(nesting PRIVATE LIBNEST2D_GEOMETRIES_clipper LIBNEST2D_OPTIMIZER_nlopt)
target_compile_options(nesting PRIVATE -fexceptions -Wno-missing-template-arg-list-after-template-kw -Wno-deprecated-builtins -Wno-unqualified-std-cast-call)
target_link_options(nesting PRIVATE --bind -fexceptions -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 -sDISABLE_EXCEPTION_CATCHING=0)
set_target_properties(nesting PROPERTIES SUFFIX ".js" RUNTIME_OUTPUT_DIRECTORY "${OUTPUT_DIR}")
