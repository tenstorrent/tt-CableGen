#!/bin/bash

set -eo pipefail

# Function to display help
show_help() {
    echo "Usage: $0 [options]..."
    echo "  -h, --help                       Show this help message."
    echo "  -b, --build-type build_type      Set the build type. Default is Release."
    echo "  --build-dir                      Build directory."
    echo "  --clean                          Remove build workspaces."
    echo ""
    echo "This script builds only the tools/scaleout directory and its dependencies."
}

clean() {
    echo "INFO: Removing build artifacts!"
    rm -rf build_Release* build built .cpmcache
    rm -rf ~/.cache/tt-metal-cache /tmp/tt-metal-cache
}

# Parse CLI options
build_type="Release"
build_dir=""

declare -a cmake_args

OPTIONS=h,b:
LONGOPTIONS="
help
build-type:
build-dir:
clean
"

# Flatten LONGOPTIONS into a comma-separated string for getopt
LONGOPTIONS=$(echo "$LONGOPTIONS" | tr '\n' ',' | sed 's/,$//')

# Parse the options
PARSED=$(getopt --options=$OPTIONS --longoptions=$LONGOPTIONS --name "$0" -- "$@")
if [[ $? -ne 0 ]]; then
    # If getopt has errors
    echo "INFO: Failed to parse arguments!"
    show_help
    exit 1
fi

eval set -- "$PARSED"
while true; do
    case "$1" in
        -h|--help)
            show_help;exit 0;;
        --build-dir)
            build_dir="$2";shift;;
        -b|--build-type)
            build_type="$2";shift;;
        --clean)
	    clean; exit 0;;
        --)
            shift;break;;
    esac
    shift
done

# Check if there are unrecognized positional arguments left
if [[ $# -gt 0 ]]; then
    echo "ERROR: Unrecognized positional argument(s): $@"
    show_help
    exit 1
fi

# Validate the build_type
VALID_BUILD_TYPES=("Release") 
if [[ ! " ${VALID_BUILD_TYPES[@]} " =~ " ${build_type} " ]]; then
    echo "ERROR: Invalid build type '$build_type'. Allowed values are Release."
    show_help
    exit 1
fi

# If build-dir is not specified, use default
if [ "$build_dir" = "" ]; then
    build_dir="build_scaleout_$build_type"
    # Create the build directory
    mkdir -p $build_dir
fi

install_prefix_default=$build_dir
cmake_install_prefix=${install_prefix:="${install_prefix_default}"}

# Set the python environment directory if not already set
if [ -z "$PYTHON_ENV_DIR" ]; then
    PYTHON_ENV_DIR=$(pwd)/python_env
fi

# Debug output to verify parsed options
echo "INFO: Build type: $build_type"
echo "INFO: Build directory: $build_dir"
echo "INFO: Install Prefix: $cmake_install_prefix"

# Prepare cmake arguments with sensible defaults
cmake_args+=("-B" "$build_dir")
cmake_args+=("-G" "Ninja")
cmake_args+=("-DCMAKE_BUILD_TYPE=$build_type")
cmake_args+=("-DCMAKE_INSTALL_PREFIX=$cmake_install_prefix")

# Set default toolchain
toolchain_path="cmake/x86_64-linux-clang-17-libstdcpp-toolchain.cmake"
echo "INFO: CMAKE_TOOLCHAIN_FILE: $toolchain_path"
cmake_args+=("-DCMAKE_TOOLCHAIN_FILE=${toolchain_path}")

# Set sensible defaults for all configuration options
cmake_args+=("-DCMAKE_EXPORT_COMPILE_COMMANDS=OFF")
cmake_args+=("-DTT_UNITY_BUILDS=ON")
cmake_args+=("-DTT_ENABLE_LIGHT_METAL_TRACE=ON")
cmake_args+=("-DENABLE_DISTRIBUTED=ON")
cmake_args+=("-DWITH_PYTHON_BINDINGS=ON")
cmake_args+=("-DPython3_EXECUTABLE=$(which python3)")
cmake_args+=("-DPython3_INCLUDE_DIR=$(python3 -c "from sysconfig import get_paths as gp; print(gp()['include'])")")
cmake_args+=("-DPython3_LIBRARY=$(python3 -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR') + '/libpython' + sysconfig.get_config_var('LDVERSION') + '.so')")")
cmake_args+=("-DENABLE_FAKE_KERNELS_TARGET=OFF")

# Force a generic x86-64 architecture to avoid illegal instructions on emulated environments
# cmake_args+=('-DCMAKE_CXX_FLAGS="${CMAKE_CXX_FLAGS} -march=x86-64"')

echo "INFO: Configuring Project for scaleout tools"
echo "INFO: Running: cmake "${cmake_args[@]}""
cmake "${cmake_args[@]}"

# Build only the scaleout visualizer dependencies
echo "INFO: Building scaleout visualizer dependencies"
cmake --build $build_dir --target scaleout_tools
cmake --build $build_dir --target 2d_big_mesh_cabling_gen
cmake --build $build_dir --target run_cabling_generator

CABLING_DESCRIPTOR_SCHEMAS_DIR="${TT_METAL_HOME}/tools/scaleout/cabling_descriptor/schemas"
DEPLOYMENT_DESCRIPTOR_SCHEMAS_DIR="${TT_METAL_HOME}/tools/scaleout/deployment_descriptor/schemas"
protoc --python_out=build/tools/scaleout/protobuf/ -I "$CABLING_DESCRIPTOR_SCHEMAS_DIR" "$CABLING_DESCRIPTOR_SCHEMAS_DIR/cluster_config.proto"
protoc --python_out=build/tools/scaleout/protobuf/ -I "$CABLING_DESCRIPTOR_SCHEMAS_DIR" "$CABLING_DESCRIPTOR_SCHEMAS_DIR/node_config.proto"
protoc --python_out=build/tools/scaleout/protobuf/ -I "$DEPLOYMENT_DESCRIPTOR_SCHEMAS_DIR" "$DEPLOYMENT_DESCRIPTOR_SCHEMAS_DIR/deployment.proto"
