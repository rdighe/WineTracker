Pod::Spec.new do |s|
  s.name           = 'NoteFlavors'
  s.version        = '1.0.0'
  s.summary        = 'On-device flavor reading of tasting notes with Apple Intelligence'
  s.description    = 'Reads flavor families from tasting notes with the Foundation Models framework for the WineTracker app'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # iOS 26+ only: weak, so the app still launches on older iOS.
  s.weak_frameworks = 'FoundationModels'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
