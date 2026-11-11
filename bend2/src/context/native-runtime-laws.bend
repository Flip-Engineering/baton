# Operative controls for admission of the Node runtime used by the selected provider.
import Base
import ./native.bend as Native

law runtime_admission_keeps_the_discovered_absolute_executable:
  {Native.node_runtime_fields(["/opt/node22/bin/node", "supported", "22.15.0"]) ==
    Native.ProviderRuntime{"/opt/node22/bin/node", "22.15.0"} : Native.ProviderAnswer}

def runtime_admission_keeps_the_discovered_absolute_executable():
  {==}

law runtime_admission_refuses_an_unsupported_version:
  {Native.node_runtime_fields(["/opt/node/bin/node", "unsupported", "22.14.9"]) ==
    Native.ProviderRefused{"nodeRuntimeUnsupported"} : Native.ProviderAnswer}

def runtime_admission_refuses_an_unsupported_version():
  {==}

law runtime_admission_refuses_a_non_absolute_executable:
  {Native.node_runtime_fields(["node", "supported", "22.23.3"]) ==
    Native.ProviderRefused{"nodeRuntimeUnsupported"} : Native.ProviderAnswer}

def runtime_admission_refuses_a_non_absolute_executable():
  {==}
