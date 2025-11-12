# TT-CableGen Dockerfile

#############################################################

# Use the published tt-metal base image instead of rebuilding
# This includes basic build tools (cmake, ninja, g++, mpi-ulfm)
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium-ubuntu-22.04-release-amd64:latest AS base

#############################################################

FROM base AS release

# Set up TT_METAL_HOME
# (PYTHON_ENV_DIR is already set in the base image)
ENV TT_METAL_HOME=/tt-metal
ENV APP_HOME=/app

COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
RUN /bin/bash -c "apt update && apt install -y protobuf-compiler"

# Clone tt-metal
# Bust cache to ensure fresh clone every time
RUN echo "Build timestamp: $(date)"
RUN /bin/bash -c "git clone --filter=blob:none --recurse-submodules --tags \
    https://github.com/tenstorrent/tt-metal.git ${TT_METAL_HOME} \
    && cd ${TT_METAL_HOME}"

WORKDIR ${TT_METAL_HOME}

COPY build_scaleout.sh ${TT_METAL_HOME}/build_scaleout.sh
RUN chmod +x ${TT_METAL_HOME}/build_scaleout.sh

WORKDIR ${APP_HOME}
# Copy Flask web server files
COPY server.py ${APP_HOME}/server.py
COPY import_cabling.py ${APP_HOME}/import_cabling.py
COPY export_descriptors.py ${APP_HOME}/export_descriptors.py
COPY templates/ ${APP_HOME}/templates/
COPY static/ ${APP_HOME}/static/

WORKDIR ${TT_METAL_HOME}

RUN /bin/bash -c "${TT_METAL_HOME}/build_scaleout.sh --build-type Release --build-dir build"

# Expose ports for telemetry server
# Port 5000: Web server
EXPOSE 5000


# Set the Flask server as the entrypoint
# This allows passing command line arguments directly to docker run
ENTRYPOINT ["/bin/bash", "-c", "python3 ${APP_HOME}/server.py -p 5000"]

#############################################################

