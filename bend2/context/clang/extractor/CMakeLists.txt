# context-clang-20: first-party LibTooling extractor for the Baton2
# clang-analyzer provider. Builds against LLVM/Clang 20 from LLVMConfig.cmake;
# the linked clang-cpp shared library and its LLVM dependency are the external
# runtime closure.
cmake_minimum_required(VERSION 3.20)
project(context-clang-20 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# LLVM release builds carry no RTTI; the consumer must match.
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-rtti")

find_package(LLVM REQUIRED CONFIG)
if(NOT LLVM_PACKAGE_VERSION VERSION_GREATER_EQUAL "20" OR
   LLVM_PACKAGE_VERSION VERSION_GREATER_EQUAL "21")
  message(FATAL_ERROR "context-clang-20 requires LLVM 20")
endif()
find_library(CLANG_CPP_LIBRARY NAMES clang-cpp PATHS ${LLVM_LIBRARY_DIRS}
  NO_DEFAULT_PATH REQUIRED)

add_executable(context-clang-20
  src/main.cpp
  src/json.cpp
  src/contract.cpp
  src/graph.cpp
  src/analyze.cpp
)

target_include_directories(context-clang-20 PRIVATE src ${LLVM_INCLUDE_DIRS})

target_link_libraries(context-clang-20 PRIVATE ${CLANG_CPP_LIBRARY} LLVM)

# Pure source tests (graph semantics, JSON); no LLVM dependency.
add_executable(context-clang-20-tests
  ${CMAKE_CURRENT_SOURCE_DIR}/../test/graph-tests.cpp
  src/json.cpp
  src/graph.cpp
)
target_include_directories(context-clang-20-tests PRIVATE src)

if(APPLE)
  target_link_options(context-clang-20 PRIVATE
      "LINKER:-no_warn_duplicate_libraries")
endif()
