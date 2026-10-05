# context-clang-20: first-party LibTooling extractor for the Baton2
# clang-analyzer provider. Builds against the pinned LLVM/Clang 20.1.8
# selected through ClangConfig.cmake; the linked clang-cpp shared library and
# its LLVM dependency are the declared external runtime closure.
cmake_minimum_required(VERSION 3.20)
project(context-clang-20 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# LLVM release builds carry no RTTI; the consumer must match.
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-rtti")

find_package(LLVM 20.1.8 REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

add_executable(context-clang-20
  src/main.cpp
  src/json.cpp
  src/contract.cpp
  src/graph.cpp
  src/analyze.cpp
)

target_include_directories(context-clang-20 PRIVATE src)

target_link_libraries(context-clang-20 PRIVATE clang-cpp LLVM)

# Keep the binary relocatable-unfriendly on purpose: the packaged artifact
# records its linked dylib identity at qualification time.
if(APPLE)
  target_link_options(context-clang-20 PRIVATE
      "LINKER:-no_warn_duplicate_libraries")
endif()
